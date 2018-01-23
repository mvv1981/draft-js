/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule splitNestedBlockInContentState
 * @format
 * @flow
 */

'use strict';

const Immutable = require('immutable');
const generateRandomKey = require('./generateRandomKey');
const invariant = require('invariant');

import type ContentState from 'ContentState';
import type SelectionState from 'SelectionState';

const {List, Map} = Immutable;

function splitNestedBlockInContentState(
    contentState: ContentState,
    selectionState: SelectionState,
): ContentState {
    invariant(selectionState.isCollapsed(), 'Selection range must be collapsed.');

    var key = selectionState.getAnchorKey();
    var offset = selectionState.getAnchorOffset();
    var blockMap = contentState.getBlockMap();
    var blockToSplit = blockMap.get(key);
    var parentKey = blockToSplit.getParentKey();

    var text = blockToSplit.getText();
    var chars = blockToSplit.getCharacterList();

    var blockAbove = blockToSplit.merge({
        text: text.slice(0, offset),
        characterList: chars.slice(0, offset),
        key: generateRandomKey(),
        parentKey
    });

    var blockBelow = blockAbove.merge({
        key: generateRandomKey(),
        parentKey,
        text: text.slice(offset),
        characterList: chars.slice(offset),
        data: Map()
    });

    var newEmptyBlock =  blockToSplit.merge({
        text: '',
        characterList: List(),
        parentKey
    });

    var blocksBefore = blockMap.toSeq().takeUntil(function (v) {
        return v === blockToSplit;
    });
    var blocksAfter = blockMap.toSeq().skipUntil(function (v) {
        return v === blockToSplit;
    }).rest();

    var newBlocks;

    if (blockAbove.text.length === 0) {
        newBlocks = blocksBefore.concat([[blockAbove.getKey(), blockAbove], [blockBelow.getKey(), blockBelow]], blocksAfter).toOrderedMap();
        return contentState.merge({
            blockMap: newBlocks,
            selectionBefore: selectionState,
            selectionAfter: selectionState.merge({
                anchorKey: blockAbove.getKey(),
                anchorOffset: 0,
                focusKey: blockAbove.getKey(),
                focusOffset: 0,
                isBackward: false
            })
        });
    }

    if (blockAbove.text.length !== 0 && blockBelow.text.length === 0) {
        newBlocks = blocksBefore.concat([[blockAbove.getKey(), blockAbove], [newEmptyBlock.getKey(), newEmptyBlock]], blocksAfter).toOrderedMap();
        return contentState.merge({
            blockMap: newBlocks,
            selectionBefore: selectionState,
            selectionAfter: selectionState.merge({
                anchorKey: newEmptyBlock.getKey(),
                anchorOffset: 0,
                focusKey: newEmptyBlock.getKey(),
                focusOffset: 0,
                isBackward: false
            })
        });
    }

    newBlocks = blocksBefore.concat([[blockAbove.getKey(), blockAbove], [newEmptyBlock.getKey(), newEmptyBlock], [blockBelow.getKey(), blockBelow]], blocksAfter).toOrderedMap();
    return contentState.merge({
        blockMap: newBlocks,
        selectionBefore: selectionState,
        selectionAfter: selectionState.merge({
            anchorKey: newEmptyBlock.getKey(),
            anchorOffset: 0,
            focusKey: newEmptyBlock.getKey(),
            focusOffset: 0,
            isBackward: false
        })
    });
}

module.exports = splitNestedBlockInContentState;
