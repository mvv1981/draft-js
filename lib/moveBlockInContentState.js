/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule moveBlockInContentState
 * @format
 * 
 */

'use strict';

var ContentBlockNode = require('./ContentBlockNode');
var Immutable = require('immutable');

var invariant = require('fbjs/lib/invariant');

var OrderedMap = Immutable.OrderedMap,
    List = Immutable.List;


var getNextDelimiterBlockKey = function getNextDelimiterBlockKey(blockToBeMoved, blockMap) {
  var nextSiblingKey = blockToBeMoved.getNextSiblingKey();

  if (nextSiblingKey) {
    return nextSiblingKey;
  }

  var parent = blockToBeMoved.getParentKey();

  if (!parent) {
    return null;
  }

  var nextNonDescendantBlock = blockMap.get(parent);
  while (nextNonDescendantBlock && (!nextNonDescendantBlock.getNextSiblingKey() || !nextNonDescendantBlock.getParentKey())) {
    var parentKey = nextNonDescendantBlock.getParentKey();
    nextNonDescendantBlock = parentKey ? blockMap.get(parentKey) : null;
  }

  if (!nextNonDescendantBlock) {
    return null;
  }

  return nextNonDescendantBlock.getNextSiblingKey();
};

var updateBlockMapLinks = function updateBlockMapLinks(blockMap, originalBlockToBeMoved, originalTargetBlock, insertionMode, isExperimentalTreeBlock) {
  if (!isExperimentalTreeBlock) {
    return blockMap;
  }
  // possible values of 'insertionMode' are: 'after', 'before'
  var isInsertedAfterTarget = insertionMode === 'after';

  var originalBlockKey = originalBlockToBeMoved.getKey();
  var originalTargetKey = originalTargetBlock.getKey();
  var originialParentKey = originalBlockToBeMoved.getParentKey();
  var originalNextSiblingKey = originalBlockToBeMoved.getNextSiblingKey();
  var originalPrevSiblingKey = originalBlockToBeMoved.getPrevSiblingKey();
  var newParentKey = originalTargetBlock.getParentKey();
  var newNextSiblingKey = isInsertedAfterTarget ? originalTargetBlock.getNextSiblingKey() : originalTargetKey;
  var newPrevSiblingKey = isInsertedAfterTarget ? originalTargetKey : originalTargetBlock.getPrevSiblingKey();

  return blockMap.withMutations(function (blocks) {
    // update old parent
    if (originialParentKey) {
      var originialParentBlock = blocks.get(originialParentKey);
      var parentChildrenList = originialParentBlock.getChildKeys();
      blocks.mergeIn(originialParentKey, originialParentBlock.merge({
        children: parentChildrenList['delete'](parentChildrenList.indexOf(originalBlockKey))
      }));
    }

    // update old prev
    if (originalPrevSiblingKey) {
      var originalPrevSiblingBlock = blocks.get(originalPrevSiblingKey);
      blocks.mergeIn(originalPrevSiblingKey, originalPrevSiblingBlock.merge({
        nextSibling: originalBlockToBeMoved.getNextSiblingKey()
      }));
    }

    // update old next
    if (originalNextSiblingKey) {
      var originalNextSiblingBlock = blocks.get(originalNextSiblingKey);
      blocks.mergeIn(originalNextSiblingKey, originalNextSiblingBlock.merge({
        prevSibling: originalBlockToBeMoved.getPrevSiblingKey()
      }));
    }

    // update new next
    if (newNextSiblingKey) {
      var newNextSiblingBlock = blocks.get(newNextSiblingKey);
      blocks.mergeIn(newNextSiblingKey, newNextSiblingBlock.merge({
        prevSibling: originalBlockKey
      }));
    }

    // update new prev
    if (newPrevSiblingKey) {
      var newPrevSiblingBlock = blocks.get(newPrevSiblingKey);
      blocks.mergeIn(newPrevSiblingKey, newPrevSiblingBlock.merge({
        nextSibling: originalBlockKey
      }));
    }

    // update new parent
    if (newParentKey) {
      var newParentBlock = blocks.get(newParentKey);
      var newParentChildrenList = newParentBlock.getChildKeys();
      var targetBlockIndex = newParentChildrenList.indexOf(originalTargetKey);

      var insertionIndex = isInsertedAfterTarget ? targetBlockIndex + 1 : targetBlockIndex !== 0 ? targetBlockIndex - 1 : 0;

      var newChildrenArray = newParentChildrenList.toArray();
      newChildrenArray.splice(insertionIndex, 0, originalBlockKey);

      blocks.mergeIn(newParentKey, newParentBlock.merge({
        children: List(newChildrenArray)
      }));
    }

    // update block
    blocks.mergeIn(originalBlockKey, originalBlockToBeMoved.merge({
      nextSibling: newNextSiblingKey,
      prevSibling: newPrevSiblingKey,
      parent: newParentKey
    }));
  });
};

var moveBlockInContentState = function moveBlockInContentState(contentState, blockToBeMoved, targetBlock, insertionMode) {
  !(insertionMode !== 'replace') ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Replacing blocks is not supported.') : invariant(false) : void 0;

  var targetKey = targetBlock.getKey();
  var blockKey = blockToBeMoved.getKey();

  !(blockKey !== targetKey) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Block cannot be moved next to itself.') : invariant(false) : void 0;

  var blockMap = contentState.getBlockMap();
  var isExperimentalTreeBlock = blockToBeMoved instanceof ContentBlockNode;

  var blocksToBeMoved = [blockToBeMoved];
  var blockMapWithoutBlocksToBeMoved = blockMap['delete'](blockKey);

  if (isExperimentalTreeBlock) {
    blocksToBeMoved = [];
    blockMapWithoutBlocksToBeMoved = blockMap.withMutations(function (blocks) {
      var nextSiblingKey = blockToBeMoved.getNextSiblingKey();
      var nextDelimiterBlockKey = getNextDelimiterBlockKey(blockToBeMoved, blocks);

      blocks.toSeq().skipUntil(function (block) {
        return block.getKey() === blockKey;
      }).takeWhile(function (block) {
        var key = block.getKey();
        var isBlockToBeMoved = key === blockKey;
        var hasNextSiblingAndIsNotNextSibling = nextSiblingKey && key !== nextSiblingKey;
        var doesNotHaveNextSiblingAndIsNotDelimiter = !nextSiblingKey && block.getParentKey() && (!nextDelimiterBlockKey || key !== nextDelimiterBlockKey);

        return !!(isBlockToBeMoved || hasNextSiblingAndIsNotNextSibling || doesNotHaveNextSiblingAndIsNotDelimiter);
      }).forEach(function (block) {
        blocksToBeMoved.push(block);
        blocks['delete'](block.getKey());
      });
    });
  }

  var blocksBefore = blockMapWithoutBlocksToBeMoved.toSeq().takeUntil(function (v) {
    return v === targetBlock;
  });

  var blocksAfter = blockMapWithoutBlocksToBeMoved.toSeq().skipUntil(function (v) {
    return v === targetBlock;
  }).skip(1);

  var slicedBlocks = blocksToBeMoved.map(function (block) {
    return [block.getKey(), block];
  });

  var newBlocks = OrderedMap();

  if (insertionMode === 'before') {
    var blockBefore = contentState.getBlockBefore(targetKey);

    !(!blockBefore || blockBefore.getKey() !== blockToBeMoved.getKey()) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Block cannot be moved next to itself.') : invariant(false) : void 0;

    newBlocks = blocksBefore.concat([].concat(slicedBlocks, [[targetKey, targetBlock]]), blocksAfter).toOrderedMap();
  } else if (insertionMode === 'after') {
    var blockAfter = contentState.getBlockAfter(targetKey);

    !(!blockAfter || blockAfter.getKey() !== blockKey) ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Block cannot be moved next to itself.') : invariant(false) : void 0;

    newBlocks = blocksBefore.concat([[targetKey, targetBlock]].concat(slicedBlocks), blocksAfter).toOrderedMap();
  }

  return contentState.merge({
    blockMap: updateBlockMapLinks(newBlocks, blockToBeMoved, targetBlock, insertionMode, isExperimentalTreeBlock),
    selectionBefore: contentState.getSelectionAfter(),
    selectionAfter: contentState.getSelectionAfter().merge({
      anchorKey: blockKey,
      focusKey: blockKey
    })
  });
};

module.exports = moveBlockInContentState;