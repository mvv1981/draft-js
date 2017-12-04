/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule wrapBlockNodes
 * @format
 * 
 *
 * This is unstable and not part of the public API and should not be used by
 * production systems. This file may be update/removed without notice.
 */

'use strict';

var React = require('react');
var DraftOffsetKey = require('./DraftOffsetKey');

var applyWrapperElementToSiblings = function applyWrapperElementToSiblings(wrapperTemplate, Element, nodes) {
  var wrappedSiblings = [];

  // we check back until we find a sibbling that does not have same wrapper
  var _iteratorNormalCompletion = true;
  var _didIteratorError = false;
  var _iteratorError = undefined;

  try {
    for (var _iterator = nodes.reverse()[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
      var sibling = _step.value;

      if (sibling.type !== Element) {
        break;
      }
      wrappedSiblings.push(sibling);
    }

    // we now should remove from acc the wrappedSiblings and add them back under same wrap
  } catch (err) {
    _didIteratorError = true;
    _iteratorError = err;
  } finally {
    try {
      if (!_iteratorNormalCompletion && _iterator['return']) {
        _iterator['return']();
      }
    } finally {
      if (_didIteratorError) {
        throw _iteratorError;
      }
    }
  }

  nodes.splice(nodes.indexOf(wrappedSiblings[0]), wrappedSiblings.length + 1);

  var children = wrappedSiblings.reverse();

  var key = children[0].key;

  nodes.push(React.cloneElement(wrapperTemplate, {
    key: key + '-wrap',
    'data-offset-key': DraftOffsetKey.encode(key, 0, 0)
  }, children));

  return nodes;
};

/**
 * We will use this helper to identify blocks that need to be wrapped but have siblings that
 * also share the same wrapper element, this way we can do the wrapping once the last sibling
 * is added.
 */
var shouldNotAddWrapperElement = function shouldNotAddWrapperElement(block, contentState) {
  var nextSiblingKey = block.getNextSiblingKey();

  return nextSiblingKey ? contentState.getBlockForKey(nextSiblingKey).getType() === block.getType() : false;
};

var wrapBlockNodes = function wrapBlockNodes(nodes, contentState) {
  return nodes.reduce(function (acc, _ref) {
    var element = _ref.element,
        block = _ref.block,
        wrapperTemplate = _ref.wrapperTemplate;

    acc.push(element);

    if (!wrapperTemplate || shouldNotAddWrapperElement(block, contentState)) {
      return acc;
    }

    applyWrapperElementToSiblings(wrapperTemplate, element.type, acc);

    return acc;
  }, []);
};

module.exports = wrapBlockNodes;