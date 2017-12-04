/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule randomizeBlockMapKeys
 * @format
 * 
 */

'use strict';

var ContentBlockNode = require('./ContentBlockNode');
var Immutable = require('immutable');

var generateRandomKey = require('./generateRandomKey');

var OrderedMap = Immutable.OrderedMap;


var randomizeContentBlockNodeKeys = function randomizeContentBlockNodeKeys(blockMap) {
  var newKeys = [];
  return OrderedMap(blockMap.withMutations(function (blockMapState) {
    blockMapState.forEach(function (block, index) {
      var oldKey = block.getKey();
      var nextKey = block.getNextSiblingKey();
      var prevKey = block.getPrevSiblingKey();
      var childrenKeys = block.getChildKeys();
      var parentKey = block.getParentKey();

      // new key that we will use to build linking
      var key = generateRandomKey();

      // we will add it here to re-use it later
      newKeys.push(key);

      if (nextKey) {
        var nextBlock = blockMapState.get(nextKey);
        if (nextBlock) {
          blockMapState.mergeIn(nextKey, nextBlock.merge({
            prevSibling: key
          }));
        } else {
          // this can happen when generating random keys for fragments
          blockMapState.mergeIn(oldKey, block.merge({
            nextSibling: null
          }));
        }
      }

      if (prevKey) {
        var prevBlock = blockMapState.get(prevKey);
        if (prevBlock) {
          blockMapState.mergeIn(prevKey, prevBlock.merge({
            nextSibling: key
          }));
        } else {
          // this can happen when generating random keys for fragments
          blockMapState.mergeIn(oldKey, block.merge({
            prevSibling: null
          }));
        }
      }

      if (parentKey) {
        var parentBlock = blockMapState.get(parentKey);
        if (parentBlock) {
          var parentChildrenList = parentBlock.getChildKeys();
          blockMapState.setIn(parentKey, parentBlock.merge({
            children: parentChildrenList.set(parentChildrenList.indexOf(block.getKey()), key)
          }));
        } else {
          blockMapState.mergeIn(oldKey, block.merge({
            parent: null
          }));
        }
      }

      childrenKeys.forEach(function (childKey) {
        var childBlock = blockMapState.get(childKey);
        if (childBlock) {
          blockMapState.mergeIn(childKey, childBlock.merge({
            parent: key
          }));
        } else {
          blockMapState.mergeIn(oldKey, block.merge({
            children: block.getChildKeys().filter(function (child) {
              return child !== childKey;
            })
          }));
        }
      });
    });
  }).toArray().map(function (block, index) {
    return [newKeys[index], block.set('key', newKeys[index])];
  }));
};

var randomizeContentBlockKeys = function randomizeContentBlockKeys(blockMap) {
  return OrderedMap(blockMap.toArray().map(function (block) {
    var key = generateRandomKey();
    return [key, block.set('key', key)];
  }));
};

var randomizeBlockMapKeys = function randomizeBlockMapKeys(blockMap) {
  var isTreeBasedBlockMap = blockMap.first() instanceof ContentBlockNode;

  if (!isTreeBasedBlockMap) {
    return randomizeContentBlockKeys(blockMap);
  }

  return randomizeContentBlockNodeKeys(blockMap);
};

module.exports = randomizeBlockMapKeys;