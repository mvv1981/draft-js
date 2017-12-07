/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule splitBlockWithNestingInContentState
 * @format
 * 
 */

'use strict';

var Immutable = require('immutable');
var generateNestedKey = require('./generateNestedKey');
var invariant = require('fbjs/lib/invariant');
var ContentBlock = require('./ContentBlock');

var List = Immutable.List;

/*
  Split a block and create a new nested block,

  If block has no nested blocks, original text from the block is split
  between 2 nested blocks

  LI "Hello World"   -->   LI ""
                            UNSTYLED "Hello"
                            UNSTYLED " World"
*/

function splitBlockWithNestingInContentState(contentState, selectionState) {
  var blockType = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 'unstyled';

  !selectionState.isCollapsed() ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Selection range must be collapsed.') : invariant(false) : void 0;

  var key = selectionState.getAnchorKey();
  var offset = selectionState.getAnchorOffset();
  var blockMap = contentState.getBlockMap();
  var blockToSplit = blockMap.get(key);

  var text = blockToSplit.getText();
  var chars = blockToSplit.getCharacterList();

  var firstNestedKey = generateNestedKey(key);
  var secondNestedKey = generateNestedKey(key);

  var newParentBlock = blockToSplit.merge({
    text: '',
    characterList: List()
  });

  var firstNestedBlock = new ContentBlock({
    key: firstNestedKey,
    type: blockType,
    text: text.slice(0, offset),
    characterList: chars.slice(0, offset)
  });

  var secondNestedBlock = new ContentBlock({
    key: secondNestedKey,
    type: blockType,
    text: text.slice(offset),
    characterList: chars.slice(offset)
  });

  var blocksBefore = blockMap.toSeq().takeUntil(function (v) {
    return v === blockToSplit;
  });
  var blocksAfter = blockMap.toSeq().skipUntil(function (v) {
    return v === blockToSplit;
  }).rest();
  var newBlocks = blocksBefore.concat([[newParentBlock.getKey(), newParentBlock], [firstNestedBlock.getKey(), firstNestedBlock], [secondNestedBlock.getKey(), secondNestedBlock]], blocksAfter).toOrderedMap();

  return contentState.merge({
    blockMap: newBlocks,
    selectionBefore: selectionState,
    selectionAfter: selectionState.merge({
      anchorKey: secondNestedKey,
      anchorOffset: 0,
      focusKey: secondNestedKey,
      focusOffset: 0,
      isBackward: false
    })
  });
}

module.exports = splitBlockWithNestingInContentState;