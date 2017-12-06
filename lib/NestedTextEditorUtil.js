'use strict';

/*
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule NestedTextEditorUtil
 * @typechecks
 * 
 */
var CharacterMetadata = require('./CharacterMetadata');
var ContentBlock = require('./ContentBlock');
var ContentState = require('./ContentState');
var DefaultDraftBlockRenderMap = require('./DefaultDraftBlockRenderMap');
var EditorState = require('./EditorState');
var Immutable = require('immutable');
var generateNestedKey = require('./generateNestedKey');
var generateRandomKey = require('./generateRandomKey');
var splitBlockWithNestingInContentState = require('./splitBlockWithNestingInContentState');

var List = Immutable.List,
    Repeat = Immutable.Repeat;


var EMPTY_CHAR = '';
var EMPTY_CHAR_LIST = List(Repeat(CharacterMetadata.create(), EMPTY_CHAR.length));

var DefaultBlockRenderMap = new Immutable.Map(new Immutable.fromJS(DefaultDraftBlockRenderMap.toJS()).mergeDeep(new Immutable.fromJS({
  blockquote: {
    nestingEnabled: true
  },
  'unordered-list-item': {
    nestingEnabled: true
  },
  'ordered-list-item': {
    nestingEnabled: true
  }
})).toJS());

var NestedTextEditorUtil = {
  DefaultBlockRenderMap: DefaultBlockRenderMap,

  toggleBlockType: function toggleBlockType(editorState, blockType) {
    var blockRenderMap = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : NestedTextEditorUtil.DefaultBlockRenderMap;

    var contentState = editorState.getCurrentContent();
    var selectionState = editorState.getSelection();
    var currentBlock = contentState.getBlockForKey(selectionState.getStartKey());
    var key = currentBlock.getKey();
    var renderOpt = blockRenderMap.get(currentBlock.getType());
    var hasNestingEnabled = renderOpt && renderOpt.nestingEnabled;
    var targetTypeRenderOpt = blockRenderMap.get(blockType);
    var parentKey = currentBlock.getParentKey();
    var parentBlock = contentState.getBlockForKey(parentKey);
    var parentRenderOpt = parentBlock && blockRenderMap.get(parentBlock.getType());
    var isCousinType = renderOpt && targetTypeRenderOpt && renderOpt.element === targetTypeRenderOpt.element;
    var isParentCousinType = parentRenderOpt && targetTypeRenderOpt && parentRenderOpt.element === targetTypeRenderOpt.element;

    var canHandleCommand = (hasNestingEnabled || targetTypeRenderOpt.nestingEnabled) && blockType !== currentBlock.getType();

    if (!canHandleCommand) {
      return {
        editorState: editorState,
        blockType: blockType
      };
    }

    var blockMap = contentState.getBlockMap();

    if (isParentCousinType) {
      var toggleCousinBlockContentState = ContentState.createFromBlockArray(blockMap.map(function (block, index) {
        if (block === parentBlock) {
          return new ContentBlock({
            key: block.getKey(),
            type: blockType,
            depth: block.getDepth(),
            text: block.getText(),
            characterList: block.getCharacterList()
          });
        }
        if (block === currentBlock) {
          return new ContentBlock({
            key: block.getKey(),
            // since we use the toggleUtils together with RichUtils we
            // need to update this type to something else so that it does not get
            // toggled and instead just get restored
            // this is a temporary hack while nesting tree is not a first customer
            type: 'unstyled',
            depth: block.getDepth(),
            text: block.getText(),
            characterList: block.getCharacterList()
          });
        }
        return block;
      }).toArray());

      return {
        editorState: EditorState.push(editorState, toggleCousinBlockContentState.merge({
          selectionBefore: selectionState,
          selectionAfter: selectionState.merge({
            anchorKey: key,
            anchorOffset: selectionState.getAnchorOffset(),
            focusKey: key,
            focusOffset: selectionState.getFocusOffset(),
            isBackward: false
          })
        }), 'change-block-type'),
        blockType: currentBlock.getType() // we then send the original type to be restored
      };
    }

    // we want to move the current text to inside this block
    var targetKey = generateNestedKey(key);

    var newContentState = ContentState.createFromBlockArray(blockMap.map(function (block, index) {
      if (block === currentBlock) {
        if (isCousinType) {
          return new ContentBlock({
            key: key,
            type: 'unstyled',
            depth: currentBlock.getDepth(),
            text: currentBlock.getText(),
            characterList: currentBlock.getCharacterList()
          });
        } else {
          return [new ContentBlock({
            key: key,
            type: currentBlock.getType(),
            depth: currentBlock.getDepth(),
            text: EMPTY_CHAR,
            characterList: EMPTY_CHAR_LIST
          }), new ContentBlock({
            key: targetKey,
            type: 'unstyled',
            depth: 0,
            text: currentBlock.getText(),
            characterList: currentBlock.getCharacterList()
          })];
        }
      }
      return block;
    }).reduce(function (a, b) {
      return a.concat(b);
    }, []));

    return {
      editorState: EditorState.push(editorState, newContentState.merge({
        selectionBefore: selectionState,
        selectionAfter: selectionState.merge({
          anchorKey: isCousinType ? key : targetKey,
          anchorOffset: selectionState.getAnchorOffset(),
          focusKey: isCousinType ? key : targetKey,
          focusOffset: selectionState.getFocusOffset(),
          isBackward: false
        })
      }), 'change-block-type'),
      blockType: blockType
    };
  },

  handleKeyCommand: function handleKeyCommand(editorState, command) {
    var blockRenderMap = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : DefaultBlockRenderMap;

    var selectionState = editorState.getSelection();
    var contentState = editorState.getCurrentContent();
    var key = selectionState.getAnchorKey();

    var currentBlock = contentState.getBlockForKey(key);
    var nestedBlocks = contentState.getBlockChildren(key);

    var parentKey = currentBlock.getParentKey();
    var parentBlock = contentState.getBlockForKey(parentKey);
    var nextBlock = contentState.getBlockAfter(key);

    // Option of rendering for the current block
    var renderOpt = blockRenderMap.get(currentBlock.getType());
    var parentRenderOpt = parentBlock && blockRenderMap.get(parentBlock.getType());

    var hasNestingEnabled = renderOpt && renderOpt.nestingEnabled;
    var hasWrapper = renderOpt && renderOpt.wrapper;

    var parentHasWrapper = parentRenderOpt && parentRenderOpt.wrapper;

    // Press enter
    if (command === 'split-block') {
      if (currentBlock.hasParent() && (!hasNestingEnabled || currentBlock.getLength() === 0) && (!nextBlock || hasWrapper && nextBlock.getType() !== currentBlock.getType() || nextBlock.getParentKey() !== currentBlock.getParentKey() && (currentBlock.getLength() === 0 || parentHasWrapper))) {
        command = 'split-parent-block';
      }

      // In a block that already have some nested blocks
      if (command === 'split-block' && nestedBlocks.size > 0) {
        command = 'split-nested-block';
      }
    }

    // Prevent creation of nested blocks
    if (!hasNestingEnabled && command === 'split-nested-block') {
      command = 'split-block';
    }

    switch (command) {
      case 'backspace':
        return NestedTextEditorUtil.onBackspace(editorState, blockRenderMap);
      case 'delete':
        return NestedTextEditorUtil.onDelete(editorState, blockRenderMap);
      case 'split-nested-block':
        return NestedTextEditorUtil.onSplitNestedBlock(editorState, blockRenderMap);
      case 'split-parent-block':
        return NestedTextEditorUtil.onSplitParent(editorState, blockRenderMap);
      default:
        return null;
    }
  },

  keyBinding: function keyBinding(e) {
    if (e.keyCode === 13 /* `Enter` key */ && e.shiftKey) {
      return 'split-nested-block';
    }
  },

  onBackspace: function onBackspace(editorState) {
    var blockRenderMap = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DefaultBlockRenderMap;

    var selectionState = editorState.getSelection();
    var isCollapsed = selectionState.isCollapsed();
    var contentState = editorState.getCurrentContent();
    var key = selectionState.getAnchorKey();

    var currentBlock = contentState.getBlockForKey(key);
    var previousBlock = contentState.getBlockBefore(key);

    var canHandleCommand = isCollapsed && selectionState.getEndOffset() === 0 && previousBlock && previousBlock.getKey() === currentBlock.getParentKey();

    if (!canHandleCommand) {
      return null;
    }

    var targetBlock = getFirstAvailableLeafBeforeBlock(currentBlock, contentState);

    if (targetBlock === currentBlock) {
      return null;
    }

    var blockMap = contentState.getBlockMap();

    var targetKey = targetBlock.getKey();

    var newContentState = ContentState.createFromBlockArray(blockMap.filter(function (block) {
      return block !== null;
    }).map(function (block, index) {
      if (!targetBlock && previousBlock === block) {
        return [new ContentBlock({
          key: targetKey,
          type: currentBlock.getType(),
          depth: currentBlock.getDepth(),
          text: currentBlock.getText(),
          characterList: currentBlock.getCharacterList()
        }), block];
      } else if (targetBlock && block === targetBlock) {
        return new ContentBlock({
          key: targetKey,
          type: targetBlock.getType(),
          depth: targetBlock.getDepth(),
          text: targetBlock.getText() + currentBlock.getText(),
          characterList: targetBlock.getCharacterList().concat(currentBlock.getCharacterList())
        });
      }
      return block;
    }).filter(function (block) {
      return block !== currentBlock;
    }).reduce(function (a, b) {
      return a.concat(b);
    }, []));

    var selectionOffset = newContentState.getBlockForKey(targetKey).getLength();

    return EditorState.push(editorState, newContentState.merge({
      selectionBefore: selectionState,
      selectionAfter: selectionState.merge({
        anchorKey: targetKey,
        anchorOffset: selectionOffset,
        focusKey: targetKey,
        focusOffset: selectionOffset,
        isBackward: false
      })
    }), 'backspace-character');
  },

  onDelete: function onDelete(editorState) {
    var blockRenderMap = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DefaultBlockRenderMap;

    var selectionState = editorState.getSelection();
    var contentState = editorState.getCurrentContent();
    var key = selectionState.getAnchorKey();

    var currentBlock = contentState.getBlockForKey(key);

    var nextBlock = contentState.getBlockAfter(key);
    var isCollapsed = selectionState.isCollapsed();

    var canHandleCommand = nextBlock && isCollapsed && selectionState.getEndOffset() === currentBlock.getLength() && contentState.getBlockChildren(nextBlock.getKey()).size;

    if (!canHandleCommand) {
      return null;
    }

    // are pressing delete while being just befefore a block that has children
    // we want instead to move the block and all its children up to this block if it supports nesting
    // otherwise split the children right after in case it doesnt
    // find the first descendand from the nextElement
    var blockMap = contentState.getBlockMap();

    // the previous block is invalid so we need a new target
    var targetBlock = getFirstAvailableLeafAfterBlock(currentBlock, contentState);

    var newContentState = ContentState.createFromBlockArray(blockMap.filter(function (block) {
      return block !== null;
    }).map(function (block, index) {
      if (block === currentBlock) {
        return new ContentBlock({
          key: key,
          type: currentBlock.getType(),
          depth: currentBlock.getDepth(),
          text: currentBlock.getText() + targetBlock.getText(),
          characterList: currentBlock.getCharacterList().concat(targetBlock.getCharacterList())
        });
      }
      return block;
    }).filter(function (block) {
      return block !== targetBlock;
    }).reduce(function (a, b) {
      return a.concat(b);
    }, []));

    var selectionOffset = currentBlock.getLength();

    return EditorState.push(editorState, newContentState.merge({
      selectionBefore: selectionState,
      selectionAfter: selectionState.merge({
        anchorKey: key,
        anchorOffset: selectionOffset,
        focusKey: key,
        focusOffset: selectionOffset,
        isBackward: false
      })
    }), 'delete-character');
  },

  onSplitNestedBlock: function onSplitNestedBlock(editorState) {
    var blockRenderMap = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DefaultBlockRenderMap;

    var selectionState = editorState.getSelection();
    var contentState = editorState.getCurrentContent();

    return EditorState.push(editorState, splitBlockWithNestingInContentState(contentState, selectionState), 'split-block');
  },

  onSplitParent: function onSplitParent(editorState) {
    var blockRenderMap = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DefaultBlockRenderMap;

    var selectionState = editorState.getSelection();
    var contentState = editorState.getCurrentContent();
    var key = selectionState.getAnchorKey();

    var currentBlock = contentState.getBlockForKey(key);

    var parentKey = currentBlock.getParentKey();
    var parentBlock = contentState.getBlockForKey(parentKey);

    // Option of rendering for the current block
    var renderOpt = blockRenderMap.get(currentBlock.getType());
    var parentRenderOpt = parentBlock && blockRenderMap.get(parentBlock.getType());

    var hasWrapper = renderOpt && renderOpt.wrapper;

    var parentHasWrapper = parentRenderOpt && parentRenderOpt.wrapper;

    var blockMap = contentState.getBlockMap();

    var targetKey = hasWrapper ? generateNestedKey(parentKey) : parentBlock && parentBlock.getParentKey() ? generateNestedKey(parentBlock.getParentKey()) : generateRandomKey();

    var newContentState = ContentState.createFromBlockArray(blockMap.filter(function (block) {
      return block !== null;
    }).map(function (block, index) {
      if (block === currentBlock) {
        var splittedBlockType = !parentHasWrapper && (hasWrapper || !parentBlock.getParentKey()) ? 'unstyled' : parentBlock.getType();
        var splittedBlock = new ContentBlock({
          key: targetKey,
          type: splittedBlockType,
          depth: parentBlock ? parentBlock.getDepth() : 0,
          text: currentBlock.getText().slice(selectionState.getEndOffset()),
          characterList: currentBlock.getCharacterList().slice(selectionState.getEndOffset())
        });

        // if we are on an empty block when we split we should remove it
        // therefore we only return the splitted block
        if (currentBlock.getLength() === 0 && contentState.getBlockChildren(key).size === 0) {
          return splittedBlock;
        }

        return [new ContentBlock({
          key: block.getKey(),
          type: block.getType(),
          depth: block.getDepth(),
          text: currentBlock.getText().slice(0, selectionState.getStartOffset()),
          characterList: currentBlock.getCharacterList().slice(0, selectionState.getStartOffset())
        }), splittedBlock];
      }
      return block;
    }).filter(function (block) {
      return block !== null;
    }).reduce(function (a, b) {
      return a.concat(b);
    }, []));

    return EditorState.push(editorState, newContentState.merge({
      selectionBefore: selectionState,
      selectionAfter: selectionState.merge({
        anchorKey: targetKey,
        anchorOffset: 0,
        focusKey: targetKey,
        focusOffset: 0,
        isBackward: false
      })
    }), 'split-block');
  }
};

function getFirstAvailableLeafBeforeBlock(block, contentState) {
  var condition = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function () {};

  var previousLeafBlock = contentState.getBlockBefore(block.getKey());

  while (!!previousLeafBlock && contentState.getBlockChildren(previousLeafBlock.getKey()).size !== 0 && !condition(previousLeafBlock)) {
    previousLeafBlock = contentState.getBlockBefore(previousLeafBlock.getKey());
  }

  return previousLeafBlock || block;
}

function getFirstAvailableLeafAfterBlock(block, contentState) {
  var condition = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function () {};

  var nextLeafBlock = contentState.getBlockAfter(block.getKey());

  while (!!nextLeafBlock && contentState.getBlockChildren(nextLeafBlock.getKey()).size !== 0 && contentState.getBlockAfter(nextLeafBlock.getKey()) && !condition(nextLeafBlock)) {
    nextLeafBlock = contentState.getBlockAfter(nextLeafBlock.getKey());
  }

  return nextLeafBlock || block;
}

module.exports = NestedTextEditorUtil;