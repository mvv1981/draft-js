/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule convertFromHTMLToContentBlocks
 * @format
 * @flow
 */

'use strict';

import type {BlockNodeRecord} from 'BlockNodeRecord';
import type {DraftBlockRenderConfig} from 'DraftBlockRenderConfig';
import type {DraftBlockRenderMap} from 'DraftBlockRenderMap';
import type {DraftBlockType} from 'DraftBlockType';
import type {DraftInlineStyle} from 'DraftInlineStyle';
import type {EntityMap} from 'EntityMap';

const CharacterMetadata = require('CharacterMetadata');
const ContentBlock = require('ContentBlock');
const ContentBlockNode = require('ContentBlockNode');
const DefaultDraftBlockRenderMap = require('DefaultDraftBlockRenderMap');
const DraftEntity = require('DraftEntity');
const DraftFeatureFlags = require('DraftFeatureFlags');
const Immutable = require('immutable');
const {Set} = require('immutable');

const generateRandomKey = require('generateRandomKey');
const getSafeBodyFromHTML = require('getSafeBodyFromHTML');
const sanitizeDraftText = require('sanitizeDraftText');

const experimentalTreeDataSupport = DraftFeatureFlags.draft_tree_data_support;

type Block = {
    type: DraftBlockType,
    depth: number,
    key?: string,
    parent?: string,
};

type Chunk = {
    text: string,
    inlines: Array<DraftInlineStyle>,
    entities: Array<string>,
    blocks: Array<Block>,
};

const {List, OrderedSet} = Immutable;

const NBSP = '&nbsp;';
const SPACE = ' ';

// Arbitrary max indent
const MAX_DEPTH = 4;

// used for replacing characters in HTML
const REGEX_CR = new RegExp('\r', 'g');
const REGEX_NBSP = new RegExp(NBSP, 'g');
const REGEX_CARRIAGE = new RegExp('&#13;?', 'g');
const REGEX_ZWS = new RegExp('&#8203;?', 'g');

// https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight
const boldValues = ['bold', 'bolder', '500', '600', '700', '800', '900'];
const notBoldValues = ['light', 'lighter', '100', '200', '300', '400'];

// Block tag flow is different because LIs do not have
// a deterministic style ;_;
const inlineTags = {
    b: 'BOLD',
    code: 'CODE',
    del: 'STRIKETHROUGH',
    em: 'ITALIC',
    i: 'ITALIC',
    s: 'STRIKETHROUGH',
    strike: 'STRIKETHROUGH',
    strong: 'BOLD',
    u: 'UNDERLINE',
};

let lastBlock;

const EMPTY_CHUNK = {
    text: '',
    inlines: [],
    entities: [],
    blocks: [],
};

const EMPTY_BLOCK = {
    children: List(),
    depth: 0,
    key: '',
    type: '',
};

const getBlockMapSupportedTags = (blockRenderMap: DraftBlockRenderMap,): Array<string> => {
    let tags = Set([]);

    blockRenderMap.forEach((draftBlock: DraftBlockRenderConfig) => {
        if (draftBlock.aliasedElements) {
            draftBlock.aliasedElements.forEach(tag => {
                tags = tags.add(tag);
            });
        }

        tags = tags.add(draftBlock.element);
    });

    return tags
        .filter(tag => tag)
        .toArray()
        .sort();
};

const getBlockTypeForTag = (tag: string): DraftBlockType => {
    switch (tag) {
      case 'ol':
        return 'ordered-list';
      case 'ul':
          return 'unordered-list';
      case 'li':
        return 'list-item';
      case 'table':
        return 'table';
      case 'tbody':
        return 'table-body';
      case 'tr':
        return 'table-row';
      case 'td':
        return 'table-cell';
      default:
        return 'paragraph';
    }
};

const processInlineTag = (tag: string,
                          node: Node,
                          currentStyle: DraftInlineStyle,): DraftInlineStyle => {
    const styleToCheck = inlineTags[tag];
    if (styleToCheck) {
        currentStyle = currentStyle.add(styleToCheck).toOrderedSet();
    } else if (node instanceof HTMLElement) {
        const htmlElement = node;
        currentStyle = currentStyle
            .withMutations(style => {
                const fontWeight = htmlElement.style.fontWeight;
                const fontStyle = htmlElement.style.fontStyle;
                const textDecoration = htmlElement.style.textDecoration;

                if (boldValues.indexOf(fontWeight) >= 0) {
                    style.add('BOLD');
                } else if (notBoldValues.indexOf(fontWeight) >= 0) {
                    style.remove('BOLD');
                }

                if (fontStyle === 'italic') {
                    style.add('ITALIC');
                } else if (fontStyle === 'normal') {
                    style.remove('ITALIC');
                }

                if (textDecoration === 'underline') {
                    style.add('UNDERLINE');
                }
                if (textDecoration === 'line-through') {
                    style.add('STRIKETHROUGH');
                }
                if (textDecoration === 'none') {
                    style.remove('UNDERLINE');
                    style.remove('STRIKETHROUGH');
                }
            })
            .toOrderedSet();
    }
    return currentStyle;
};

const joinChunks = (A: Chunk,
                    B: Chunk,
                    rootNested?: boolean,
                    isSibling?: boolean,
                    isUnstyled?: boolean,): Chunk => {
    // Sometimes two blocks will touch in the DOM and we need to strip the
    // extra delimiter to preserve niceness.
    const lastInA = A.text.slice(-1);
    const firstInB = B.text.slice(0, 1);

    if (lastInA === '\r' && firstInB === '\r' && A.blocks[A.blocks.length - 1].type === "paragraph" && B.blocks[0].type !== "paragraph") {
        A.text = A.text.split('\r')[0];
    }

    if (lastInA === '\r' && firstInB === '\r' && A.blocks[A.blocks.length - 1].type === "paragraph" && B.blocks[0].type === "paragraph") {
        A.text = A.text.split('\r')[0];
    }

    return {
        text: isSibling && !isUnstyled ? A.text.split('\r').concat(B.text.split('\r')).join('\r') : A.text + B.text,
        inlines: A.inlines.concat(B.inlines),
        entities: A.entities.concat(B.entities),
        blocks: isUnstyled ? B.blocks : A.blocks.concat(B.blocks),
    };
};

/**
 * Check to see if we have anything like <p> <blockquote> <h1>... to create
 * block tags from. If we do, we can use those and ignore <div> tags. If we
 * don't, we can treat <div> tags as meaningful (unstyled) blocks.
 */
const containsSemanticBlockMarkup = (html: string,
                                     blockTags: Array<string>,): boolean => {
    return blockTags.some(tag => html.indexOf('<' + tag) !== -1);
};

const getChunkedBlock = (props: Object = {}): Block => {
    return {
        ...EMPTY_BLOCK,
        ...props,
    };
};

const getBlockDividerChunk = (block: DraftBlockType,
                              depth: number,
                              parentKey): Chunk => {
    return {
        text: '\r',
        inlines: [OrderedSet()],
        entities: new Array(1),
        blocks: [
            getChunkedBlock({
                parentKey: parentKey || '',
                key: generateRandomKey(),
                type: block,
                depth: Math.max(0, Math.min(MAX_DEPTH, depth)),
            }),
        ],
    };
};

const genFragment = (entityMap: EntityMap,
                     node: Node,
                     inlineStyle: DraftInlineStyle,
                     lastList: string,
                     inBlock: ?boolean,
                     blockTags: Array<string>,
                     depth: number,
                     blockRenderMap: DraftBlockRenderMap,
                     inEntity?: ?string,
                     parentKey?: ?string,): { chunk: Chunk, entityMap: EntityMap } => {
    let nodeName = node.nodeName.toLowerCase();
    let newEntityMap = entityMap;
    let chunk = {...EMPTY_CHUNK};
    let newChunk: ?Chunk = null;
    let isUnstyled = false;

    // Base Case
    if (nodeName === '#text') {
        let text = node.textContent;

        return {
            chunk: {
                text,
                inlines: Array(text.length).fill(inlineStyle),
                entities: Array(text.length).fill(inEntity),
                blocks: [
                    {
                        depth: depth,
                        key: generateRandomKey(),
                        parentKey: parentKey || '',
                        type: "paragraph",
                    },
                ],
            },
            entityMap,
        };
    }

    if (nodeName === 'br') {
        return {
            chunk: {
                text: '',
                inlines: [],
                entities: [],
                blocks: [
                    {
                        depth: depth,
                        key: generateRandomKey(),
                        parentKey: parentKey || '',
                        type: "paragraph",
                    },
                ],
            },
            entityMap,
        };
    }

    // Inline tags
    inlineStyle = processInlineTag(nodeName, node, inlineStyle);

    const nestedBlockType = getBlockTypeForTag(nodeName);

    if (nodeName === 'ul' || nodeName === 'ol') {
        newChunk = getBlockDividerChunk(nestedBlockType, depth, parentKey);
        chunk = joinChunks(chunk, newChunk);
        parentKey = chunk.blocks[0].key;
    }

    if (nodeName === 'li') {
        newChunk = getBlockDividerChunk(nestedBlockType, depth, parentKey);
        chunk = joinChunks(chunk, newChunk);
        parentKey = chunk.blocks[0].key;
    }

    if (nodeName === 'table') {
        newChunk = getBlockDividerChunk(nestedBlockType, depth, parentKey);
        chunk = joinChunks(chunk, newChunk);
        parentKey = chunk.blocks[0].key;
    }

    if (nodeName === 'tbody') {
        newChunk = getBlockDividerChunk(nestedBlockType, depth, parentKey);
        chunk = joinChunks(chunk, newChunk);
        parentKey = chunk.blocks[0].key;
    }

    if (nodeName === 'tr') {
        newChunk = getBlockDividerChunk(nestedBlockType, depth, parentKey);
        chunk = joinChunks(chunk, newChunk);
        parentKey = chunk.blocks[0].key;
    }

    if (nodeName === 'td') {
        newChunk = getBlockDividerChunk(nestedBlockType, depth, parentKey);
        chunk = joinChunks(chunk, newChunk);
        parentKey = chunk.blocks[0].key;
    }

    // Recurse through children
    let child: ?Node = node.firstChild;

    if (child && child.nodeName.toLowerCase() === 'span') {
        isUnstyled = true;
    }

    let entityId: ?string = null;

    let isSibling = false;

    while (child) {
        entityId = undefined;

        const {
            chunk: generatedChunk,
            entityMap: maybeUpdatedEntityMap,
        } = genFragment(
            newEntityMap,
            child,
            inlineStyle,
            lastList,
            true,
            blockTags,
            depth,
            blockRenderMap,
            entityId || inEntity,
            parentKey,
        );

        newChunk = generatedChunk;
        newEntityMap = maybeUpdatedEntityMap;

        chunk = joinChunks(chunk, newChunk, inBlock, isSibling, isUnstyled);
        const sibling: ?Node = child.nextSibling;

        if (sibling) {
            isSibling = true;
            nodeName = sibling.nodeName.toLowerCase();
        }
        child = sibling;
    }

    return {chunk, entityMap: newEntityMap};
};

const getChunkForHTML = (html: string,
                         DOMBuilder: Function,
                         blockRenderMap: DraftBlockRenderMap,
                         entityMap: EntityMap,): ?{ chunk: Chunk, entityMap: EntityMap } => {
    html = html
        .trim()
        .replace(REGEX_CR, '')
        .replace(REGEX_NBSP, SPACE)
        .replace(REGEX_CARRIAGE, '')
        .replace(REGEX_ZWS, '');

    const supportedBlockTags = getBlockMapSupportedTags(blockRenderMap);

    const safeBody = DOMBuilder(html);
    if (!safeBody) {
        return null;
    }

    // Sometimes we aren't dealing with content that contains nice semantic
    // tags. In this case, use divs to separate everything out into paragraphs
    // and hope for the best.
    const workingBlocks = containsSemanticBlockMarkup(html, supportedBlockTags)
        ? supportedBlockTags
        : ['div'];

    // Start with -1 block depth to offset the fact that we are passing in a fake
    // UL block to start with.
    const fragment = genFragment(
        entityMap,
        safeBody,
        OrderedSet(),
        'ul',
        null,
        workingBlocks,
        -1,
        blockRenderMap,
    );

    let chunk = fragment.chunk;
    const newEntityMap = fragment.entityMap;

    // If we saw no block tags, put an unstyled one in
    if (chunk.blocks.length === 0) {
        chunk.blocks.push({
            ...EMPTY_CHUNK,
            type: 'paragraph',
            depth: 0,
        });
    }

    return {chunk, entityMap: newEntityMap};
};

const convertChunkToContentBlocks = (chunk: Chunk): ?Array<BlockNodeRecord> => {
    if (!chunk || !chunk.text || !Array.isArray(chunk.blocks)) {
        return null;
    }

    const initialState = {
        cacheRef: {},
        contentBlocks: [],
    };

    let start = 0;

    const {blocks: rawBlocks, inlines: rawInlines, entities: rawEntities} = chunk;

    const BlockNodeRecord = ContentBlock;

    const newArr = chunk.text.split('\r');

    return newArr.reduce((acc, textBlock, index) => {
        // Make absolutely certain that our text is acceptable.
        textBlock = sanitizeDraftText(textBlock);

        const block = rawBlocks[index];
        const end = start + (textBlock.length ? textBlock.length : 1);
        const inlines = rawInlines.slice(start, end);
        const entities = rawEntities.slice(start, end);
        const characterList = List(
            inlines.map((style, index) => {
                const data = {style, entity: (null: ?string)};
                if (entities[index]) {
                    data.entity = entities[index];
                }
                return CharacterMetadata.create(data);
            }),
        );
        start = end;

        if (block) {
            const {depth, type, parentKey} = block;
            const key = block.key || generateRandomKey();
            let parentTextNodeKey = null; // will be used to store container text nodes

            const blockNode = new BlockNodeRecord({
                key,
                parentKey,
                type,
                depth,
                text: textBlock,
                characterList,
                prevSibling: parentTextNodeKey || (index === 0 || rawBlocks[index - 1].parent !== parent ? null : rawBlocks[index - 1].key),
                nextSibling: index === rawBlocks.length - 1 || rawBlocks[index + 1].parent !== parent ? null : rawBlocks[index + 1].key
            });

            acc.contentBlocks.push(blockNode);

            // cache ref for building links
            acc.cacheRef[blockNode.key] = index;

            return acc;
        }

        const blockNode = new BlockNodeRecord({
            key: generateRandomKey(),
            parentKey: '',
            type: 'paragraph',
            depth: 0,
            text: '',
            characterList: List(),
        });

        acc.contentBlocks.push(blockNode);

        // cache ref for building links
        acc.cacheRef[blockNode.key] = index;

        return acc;

    }, initialState).contentBlocks;
};

const convertFromHTMLtoContentBlocks = (html: string,
                                        DOMBuilder: Function = getSafeBodyFromHTML,
                                        blockRenderMap?: DraftBlockRenderMap = DefaultDraftBlockRenderMap,): ?{ contentBlocks: ?Array<BlockNodeRecord>, entityMap: EntityMap } => {
    // Be ABSOLUTELY SURE that the dom builder you pass here won't execute
    // arbitrary code in whatever environment you're running this in. For an
    // example of how we try to do this in-browser, see getSafeBodyFromHTML.

    // TODO: replace DraftEntity with an OrderedMap here
    const chunkData = getChunkForHTML(
        html,
        DOMBuilder,
        blockRenderMap,
        DraftEntity,
    );

    if (chunkData == null) {
        return null;
    }

    const {chunk, entityMap} = chunkData;
    const contentBlocks = convertChunkToContentBlocks(chunk);

    return {
        contentBlocks,
        entityMap,
    };
};

module.exports = convertFromHTMLtoContentBlocks;
