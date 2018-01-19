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
 * 
 */

'use strict';

var Immutable = require('immutable');
var generateNestedKey = require('./generateNestedKey');
var invariant = require('fbjs/lib/invariant');

var List = Immutable.List,
    Map = Immutable.Map;


function splitNestedBlockInContentState(contentState, selectionState) {
    !selectionState.isCollapsed() ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Selection range must be collapsed.') : invariant(false) : void 0;

    var key = selectionState.getAnchorKey();
    var offset = selectionState.getAnchorOffset();
    var blockMap = contentState.getBlockMap();
    var blockToSplit = blockMap.get(key);
    var getParentKey = blockToSplit.getParentKey();

    var text = blockToSplit.getText();
    var chars = blockToSplit.getCharacterList();

    var blockAbove = blockToSplit.merge({
        text: text.slice(0, offset),
        characterList: chars.slice(0, offset),
        key: generateNestedKey(getParentKey)
    });

    var blockBelow = blockAbove.merge({
        key: generateNestedKey(getParentKey),
        text: text.slice(offset),
        characterList: chars.slice(offset),
        data: Map()
    });

    var newEmptyBlock = blockToSplit.merge({
        text: '',
        characterList: List()
    });

    var blocksBefore = blockMap.toSeq().takeUntil(function (v) {
        return v === blockToSplit;
    });
    var blocksAfter = blockMap.toSeq().skipUntil(function (v) {
        return v === blockToSplit;
    }).rest();

    var newBlocks = blocksBefore.concat([[blockAbove.getKey(), blockAbove], [newEmptyBlock.getKey(), newEmptyBlock], [blockBelow.getKey(), blockBelow]], blocksAfter).toOrderedMap();

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