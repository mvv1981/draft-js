/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule DraftEditorBlocks.react
 * @format
 * 
 */

'use strict';

var _assign = require('object-assign');

var _extends = _assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var DraftEditorBlock = require('./DraftEditorBlock.react');
var DraftOffsetKey = require('./DraftOffsetKey');
var React = require('react');

var cx = require('fbjs/lib/cx');
var joinClasses = require('fbjs/lib/joinClasses');
var nullthrows = require('fbjs/lib/nullthrows');

/**
 * `DraftEditorBlocks` is the container component for all block components
 * rendered for a `DraftEditor`. It is optimized to aggressively avoid
 * re-rendering blocks whenever possible.
 *
 * This component is separate from `DraftEditor` because certain props
 * (for instance, ARIA props) must be allowed to update without affecting
 * the contents of the editor.
 */
var DraftEditorBlocks = function (_React$Component) {
  _inherits(DraftEditorBlocks, _React$Component);

  function DraftEditorBlocks() {
    _classCallCheck(this, DraftEditorBlocks);

    return _possibleConstructorReturn(this, _React$Component.apply(this, arguments));
  }

  DraftEditorBlocks.prototype.render = function render() {
    var _this2 = this;

    var _props = this.props,
        type = _props.type,
        content = _props.content,
        blockRenderMap = _props.blockRenderMap,
        blockRendererFn = _props.blockRendererFn,
        blockStyleFn = _props.blockStyleFn,
        customStyleMap = _props.customStyleMap,
        blockMap = _props.blockMap,
        blockMapTree = _props.blockMapTree,
        selection = _props.selection,
        forceSelection = _props.forceSelection,
        decorator = _props.decorator,
        directionMap = _props.directionMap,
        getBlockTree = _props.getBlockTree,
        getBlockChildren = _props.getBlockChildren,
        getBlockDescendants = _props.getBlockDescendants;


    var blocks = [];
    var currentWrapperElement = null;
    var currentWrapperTemplate = null;
    var currentComponentTemplate = null;
    var currentDepth = null;
    var currentWrappedBlocks = void 0;
    var key = void 0,
        blockType = void 0,
        child = void 0,
        childProps = void 0,
        wrapperTemplate = void 0,
        componentTemplate = void 0;

    blockMap.forEach(function (block) {
      key = block.getKey();
      blockType = block.getType();

      var customRenderer = blockRendererFn(block);
      var CustomComponent = void 0,
          customProps = void 0,
          customEditable = void 0;
      if (customRenderer) {
        CustomComponent = customRenderer.component;
        customProps = customRenderer.props;
        customEditable = customRenderer.editable;
      }

      var direction = directionMap.get(key);
      var offsetKey = DraftOffsetKey.encode(key, 0, 0);
      var blockChildren = blockMapTree.getIn([key, 'firstLevelBlocks']);

      var componentProps = {
        block: block,
        blockProps: customProps,
        contentState: content,
        customStyleMap: customStyleMap,
        decorator: decorator,
        direction: direction,
        directionMap: directionMap,
        forceSelection: forceSelection,
        key: key,
        offsetKey: offsetKey,
        selection: selection,
        blockRenderMap: blockRenderMap,
        blockRendererFn: blockRendererFn,
        blockStyleFn: blockStyleFn,
        blockMapTree: blockMapTree,
        blockMap: blockChildren,
        getBlockTree: getBlockTree,
        getBlockChildren: getBlockChildren,
        getBlockDescendants: getBlockDescendants,
        DraftEditorBlocks: DraftEditorBlocks,
        tree: getBlockTree(key)
      };

      // Block render map must have a configuration specified for this
      // block type.
      var configForType = nullthrows(blockRenderMap.get(blockType));

      wrapperTemplate = configForType.wrapper;
      componentTemplate = configForType.component;

      var useNewWrapper = wrapperTemplate !== currentWrapperTemplate;

      var Element = blockRenderMap.get(blockType).element || blockRenderMap.get('unstyled').element;

      var depth = block.getDepth();
      var className = blockStyleFn(block);

      // List items are special snowflakes, since we handle nesting and
      // counters manually.
      if (Element === 'li') {
        var shouldResetCount = useNewWrapper || currentDepth === null || depth > currentDepth;
        className = joinClasses(className, getListItemClasses(blockType, depth, shouldResetCount, direction));
      }

      var Component = CustomComponent || DraftEditorBlock;
      childProps = {
        className: className,
        'data-block': true,
        'data-editor': _this2.props.editorKey,
        'data-offset-key': offsetKey,
        key: key
      };
      if (customEditable !== undefined) {
        childProps = _extends({}, childProps, {
          contentEditable: customEditable,
          suppressContentEditableWarning: true
        });
      }

      child = React.createElement(Element, childProps, React.createElement(Component, componentProps));

      if (componentTemplate) {
        currentWrappedBlocks = [];
        currentWrapperElement = React.cloneElement(componentTemplate, {
          key: key + '-wrap',
          'data-offset-key': offsetKey
        }, currentWrappedBlocks);
        currentComponentTemplate = componentTemplate;
        blocks.push(currentWrapperElement);
        currentDepth = block.getDepth();
        nullthrows(currentWrappedBlocks).push(child);
      } else if (wrapperTemplate) {
        if (useNewWrapper) {
          currentWrappedBlocks = [];
          currentWrapperElement = React.cloneElement(wrapperTemplate, {
            key: key + '-wrap',
            'data-offset-key': offsetKey
          }, currentWrappedBlocks);
          currentWrapperTemplate = wrapperTemplate;
          blocks.push(currentWrapperElement);
        }
        currentDepth = block.getDepth();
        nullthrows(currentWrappedBlocks).push(child);
      } else {
        currentWrappedBlocks = null;
        currentWrapperElement = null;
        currentWrapperTemplate = null;
        currentDepth = null;
        blocks.push(child);
      }
    });

    var dataContents = type === 'contents' ? true : null;
    var dataBlocks = dataContents ? null : true;

    return [].concat(blocks);
  };

  return DraftEditorBlocks;
}(React.Component);

/**
 * Provide default styling for list items. This way, lists will be styled with
 * proper counters and indentation even if the caller does not specify
 * their own styling at all. If more than five levels of nesting are needed,
 * the necessary CSS classes can be provided via `blockStyleFn` configuration.
 */


function getListItemClasses(type, depth, shouldResetCount, direction) {
  return cx({
    'public/DraftStyleDefault/unorderedListItem': type === 'unordered-list-item',
    'public/DraftStyleDefault/orderedListItem': type === 'ordered-list-item',
    'public/DraftStyleDefault/reset': shouldResetCount,
    'public/DraftStyleDefault/depth0': depth === 0,
    'public/DraftStyleDefault/depth1': depth === 1,
    'public/DraftStyleDefault/depth2': depth === 2,
    'public/DraftStyleDefault/depth3': depth === 3,
    'public/DraftStyleDefault/depth4': depth === 4,
    'public/DraftStyleDefault/listLTR': direction === 'LTR',
    'public/DraftStyleDefault/listRTL': direction === 'RTL'
  });
}

module.exports = DraftEditorBlocks;