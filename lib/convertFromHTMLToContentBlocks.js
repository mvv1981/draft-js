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
 * 
 */

'use strict';

var _assign = require('object-assign');

var _extends = _assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var CharacterMetadata = require('./CharacterMetadata');
var ContentBlock = require('./ContentBlock');
var ContentBlockNode = require('./ContentBlockNode');
var DefaultDraftBlockRenderMap = require('./DefaultDraftBlockRenderMap');
var DraftEntity = require('./DraftEntity');
var DraftFeatureFlags = require('./DraftFeatureFlags');
var Immutable = require('immutable');

var _require = require('immutable'),
    Set = _require.Set;

var generateRandomKey = require('./generateRandomKey');
var getSafeBodyFromHTML = require('./getSafeBodyFromHTML');
var sanitizeDraftText = require('./sanitizeDraftText');

var experimentalTreeDataSupport = DraftFeatureFlags.draft_tree_data_support;

var List = Immutable.List,
    OrderedSet = Immutable.OrderedSet;


var NBSP = '&nbsp;';
var SPACE = ' ';

// Arbitrary max indent
var MAX_DEPTH = 4;

// used for replacing characters in HTML
var REGEX_CR = new RegExp('\r', 'g');
var REGEX_NBSP = new RegExp(NBSP, 'g');
var REGEX_CARRIAGE = new RegExp('&#13;?', 'g');
var REGEX_ZWS = new RegExp('&#8203;?', 'g');

// https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight
var boldValues = ['bold', 'bolder', '500', '600', '700', '800', '900'];
var notBoldValues = ['light', 'lighter', '100', '200', '300', '400'];

// Block tag flow is different because LIs do not have
// a deterministic style ;_;
var inlineTags = {
    b: 'BOLD',
    code: 'CODE',
    del: 'STRIKETHROUGH',
    em: 'ITALIC',
    i: 'ITALIC',
    s: 'STRIKETHROUGH',
    strike: 'STRIKETHROUGH',
    strong: 'BOLD',
    u: 'UNDERLINE'
};

var lastBlock = void 0;

var EMPTY_CHUNK = {
    text: '',
    inlines: [],
    entities: [],
    blocks: []
};

var EMPTY_BLOCK = {
    children: List(),
    depth: 0,
    key: '',
    type: ''
};

var getBlockMapSupportedTags = function getBlockMapSupportedTags(blockRenderMap) {
    var tags = Set([]);

    blockRenderMap.forEach(function (draftBlock) {
        if (draftBlock.aliasedElements) {
            draftBlock.aliasedElements.forEach(function (tag) {
                tags = tags.add(tag);
            });
        }

        tags = tags.add(draftBlock.element);
    });

    return tags.filter(function (tag) {
        return tag;
    }).toArray().sort();
};

var getBlockTypeForTag = function getBlockTypeForTag(tag) {
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

var processInlineTag = function processInlineTag(tag, node, currentStyle) {
    var styleToCheck = inlineTags[tag];
    if (styleToCheck) {
        currentStyle = currentStyle.add(styleToCheck).toOrderedSet();
    } else if (node instanceof HTMLElement) {
        var htmlElement = node;
        currentStyle = currentStyle.withMutations(function (style) {
            var fontWeight = htmlElement.style.fontWeight;
            var fontStyle = htmlElement.style.fontStyle;
            var textDecoration = htmlElement.style.textDecoration;

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
        }).toOrderedSet();
    }
    return currentStyle;
};

var joinChunks = function joinChunks(A, B, rootNested, isSibling, isUnstyled) {
    // Sometimes two blocks will touch in the DOM and we need to strip the
    // extra delimiter to preserve niceness.
    var lastInA = A.text.slice(-1);
    var firstInB = B.text.slice(0, 1);

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
        blocks: isUnstyled ? B.blocks : A.blocks.concat(B.blocks)
    };
};

/**
 * Check to see if we have anything like <p> <blockquote> <h1>... to create
 * block tags from. If we do, we can use those and ignore <div> tags. If we
 * don't, we can treat <div> tags as meaningful (unstyled) blocks.
 */
var containsSemanticBlockMarkup = function containsSemanticBlockMarkup(html, blockTags) {
    return blockTags.some(function (tag) {
        return html.indexOf('<' + tag) !== -1;
    });
};

var getChunkedBlock = function getChunkedBlock() {
    var props = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    return _extends({}, EMPTY_BLOCK, props);
};

var getBlockDividerChunk = function getBlockDividerChunk(block, depth, parentKey) {
    return {
        text: '\r',
        inlines: [OrderedSet()],
        entities: new Array(1),
        blocks: [getChunkedBlock({
            parentKey: parentKey || '',
            key: generateRandomKey(),
            type: block,
            depth: Math.max(0, Math.min(MAX_DEPTH, depth))
        })]
    };
};

var genFragment = function genFragment(entityMap, node, inlineStyle, lastList, inBlock, blockTags, depth, blockRenderMap, inEntity, parentKey) {
    var nodeName = node.nodeName.toLowerCase();
    var newEntityMap = entityMap;
    var chunk = _extends({}, EMPTY_CHUNK);
    var newChunk = null;
    var isUnstyled = false;

    // Base Case
    if (nodeName === '#text') {
        var _text = node.textContent;

        return {
            chunk: {
                text: _text,
                inlines: Array(_text.length).fill(inlineStyle),
                entities: Array(_text.length).fill(inEntity),
                blocks: [{
                    depth: depth,
                    key: generateRandomKey(),
                    parentKey: parentKey || '',
                    type: "paragraph"
                }]
            },
            entityMap: entityMap
        };
    }

    if (nodeName === 'br') {
        return {
            chunk: {
                text: '',
                inlines: [],
                entities: [],
                blocks: [{
                    depth: depth,
                    key: generateRandomKey(),
                    parentKey: parentKey || '',
                    type: "paragraph"
                }]
            },
            entityMap: entityMap
        };
    }

    // Inline tags
    inlineStyle = processInlineTag(nodeName, node, inlineStyle);

    var nestedBlockType = getBlockTypeForTag(nodeName);

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
    var child = node.firstChild;

    if (child && child.nodeName.toLowerCase() === 'span') {
        isUnstyled = true;
    }

    var entityId = null;

    var isSibling = false;

    while (child) {
        entityId = undefined;

        var _genFragment = genFragment(newEntityMap, child, inlineStyle, lastList, true, blockTags, depth, blockRenderMap, entityId || inEntity, parentKey),
            generatedChunk = _genFragment.chunk,
            maybeUpdatedEntityMap = _genFragment.entityMap;

        newChunk = generatedChunk;
        newEntityMap = maybeUpdatedEntityMap;

        chunk = joinChunks(chunk, newChunk, inBlock, isSibling, isUnstyled);
        var sibling = child.nextSibling;

        if (sibling) {
            isSibling = true;
            nodeName = sibling.nodeName.toLowerCase();
        }
        child = sibling;
    }

    return { chunk: chunk, entityMap: newEntityMap };
};

var getChunkForHTML = function getChunkForHTML(html, DOMBuilder, blockRenderMap, entityMap) {
    html = html.trim().replace(REGEX_CR, '').replace(REGEX_NBSP, SPACE).replace(REGEX_CARRIAGE, '').replace(REGEX_ZWS, '');

    var supportedBlockTags = getBlockMapSupportedTags(blockRenderMap);

    var safeBody = DOMBuilder(html);
    if (!safeBody) {
        return null;
    }

    // Sometimes we aren't dealing with content that contains nice semantic
    // tags. In this case, use divs to separate everything out into paragraphs
    // and hope for the best.
    var workingBlocks = containsSemanticBlockMarkup(html, supportedBlockTags) ? supportedBlockTags : ['div'];

    // Start with -1 block depth to offset the fact that we are passing in a fake
    // UL block to start with.
    var fragment = genFragment(entityMap, safeBody, OrderedSet(), 'ul', null, workingBlocks, -1, blockRenderMap);

    var chunk = fragment.chunk;
    var newEntityMap = fragment.entityMap;

    // If we saw no block tags, put an unstyled one in
    if (chunk.blocks.length === 0) {
        chunk.blocks.push(_extends({}, EMPTY_CHUNK, {
            type: 'paragraph',
            depth: 0
        }));
    }

    return { chunk: chunk, entityMap: newEntityMap };
};

var convertChunkToContentBlocks = function convertChunkToContentBlocks(chunk) {
    if (!chunk || !chunk.text || !Array.isArray(chunk.blocks)) {
        return null;
    }

    var initialState = {
        cacheRef: {},
        contentBlocks: []
    };

    var start = 0;

    var rawBlocks = chunk.blocks,
        rawInlines = chunk.inlines,
        rawEntities = chunk.entities;


    var BlockNodeRecord = ContentBlock;

    var newArr = chunk.text.split('\r');

    return newArr.reduce(function (acc, textBlock, index) {
        // Make absolutely certain that our text is acceptable.
        textBlock = sanitizeDraftText(textBlock);

        var block = rawBlocks[index];
        var end = start + (textBlock.length ? textBlock.length : 1);
        var inlines = rawInlines.slice(start, end);
        var entities = rawEntities.slice(start, end);
        var characterList = List(inlines.map(function (style, index) {
            var data = { style: style, entity: null };
            if (entities[index]) {
                data.entity = entities[index];
            }
            return CharacterMetadata.create(data);
        }));
        start = end;

        if (block) {
            var _depth = block.depth,
                _type = block.type,
                parentKey = block.parentKey;

            var _key = block.key || generateRandomKey();
            var parentTextNodeKey = null; // will be used to store container text nodes

            var _blockNode = new BlockNodeRecord({
                key: _key,
                parentKey: parentKey,
                type: _type,
                depth: _depth,
                text: textBlock,
                characterList: characterList,
                prevSibling: parentTextNodeKey || (index === 0 || rawBlocks[index - 1].parent !== parent ? null : rawBlocks[index - 1].key),
                nextSibling: index === rawBlocks.length - 1 || rawBlocks[index + 1].parent !== parent ? null : rawBlocks[index + 1].key
            });

            acc.contentBlocks.push(_blockNode);

            // cache ref for building links
            acc.cacheRef[_blockNode.key] = index;

            return acc;
        }

        var blockNode = new BlockNodeRecord({
            key: generateRandomKey(),
            parentKey: '',
            type: 'paragraph',
            depth: 0,
            text: '',
            characterList: List()
        });

        acc.contentBlocks.push(blockNode);

        // cache ref for building links
        acc.cacheRef[blockNode.key] = index;

        return acc;
    }, initialState).contentBlocks;
};

var convertFromHTMLtoContentBlocks = function convertFromHTMLtoContentBlocks(html) {
    var DOMBuilder = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : getSafeBodyFromHTML;
    var blockRenderMap = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : DefaultDraftBlockRenderMap;

    // Be ABSOLUTELY SURE that the dom builder you pass here won't execute
    // arbitrary code in whatever environment you're running this in. For an
    // example of how we try to do this in-browser, see getSafeBodyFromHTML.

    // TODO: replace DraftEntity with an OrderedMap here
    var chunkData = getChunkForHTML(html, DOMBuilder, blockRenderMap, DraftEntity);

    if (chunkData == null) {
        return null;
    }

    var chunk = chunkData.chunk,
        entityMap = chunkData.entityMap;

    var contentBlocks = convertChunkToContentBlocks(chunk);

    return {
        contentBlocks: contentBlocks,
        entityMap: entityMap
    };
};

module.exports = convertFromHTMLtoContentBlocks;