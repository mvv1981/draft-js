/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule setDraftEditorSelection
 * @format
 * @flow
 */

'use strict';

import type SelectionState from 'SelectionState';

const DraftJsDebugLogging = require('DraftJsDebugLogging');

const containsNode = require('containsNode');
const getActiveElement = require('getActiveElement');
const invariant = require('invariant');

/**
 * Bugfix: https://stackoverflow.com/questions/22914075/javascript-error-800a025e-using-range-selector
 */
function protectedRemoveAllRanges(selection) {
  const isAllIeButEdge = document.body.createTextRange;
  const willCrashInIE =
    selection.rangeCount === 0 ||
    selection.getRangeAt(0).getClientRects().length === 0;

  if (isAllIeButEdge && willCrashInIE) {
    window.getSelection().removeAllRanges();
  } else {
    selection.removeAllRanges();
  }
}

// This magic works and no one word can be excluded.
function resetIESelection() {
  const target = document.createElement('div');
  target.style.position = 'absolute';
  document.body.appendChild(target);

  window.getSelection().removeAllRanges();
  const range2 = document.createRange();
  try {
    window.getSelection().addRange(range2);
  } catch (error) {}

  document.body.removeChild(target);
}

function protectedAddRage(selection, range) {
  const isItIE = document.body.createTextRange;
  if (isItIE) {
    const selectionHasNoRanges = selection.rangeCount === 0 ||selection.getRangeAt(0).getClientRects().length === 0;
    const emptyRange = range.startOffset === range.endOffset;
    const noAnchorAndFocus = !selection.anchorNode && !selection.focusNode;
    const isIECrashes = selectionHasNoRanges && emptyRange && noAnchorAndFocus;
    if (isIECrashes) {
      resetIESelection();
      window.getSelection().addRange(range);
      return;
    }
  }

  selection.addRange(range);
}

function getAnonymizedDOM(
  node: Node,
  getNodeLabels?: (n: Node) => Array<string>,
): string {
  if (!node) {
    return '[empty]';
  }

  var anonymized = anonymizeTextWithin(node, getNodeLabels);
  if (anonymized.nodeType === Node.TEXT_NODE) {
    return anonymized.textContent;
  }

  invariant(
    anonymized instanceof Element,
    'Node must be an Element if it is not a text node.',
  );
  return anonymized.outerHTML;
}

function anonymizeTextWithin(
  node: Node,
  getNodeLabels?: (n: Node) => Array<string>,
): Node {
  const labels = getNodeLabels !== undefined ? getNodeLabels(node) : [];

  if (node.nodeType === Node.TEXT_NODE) {
    var length = node.textContent.length;
    return document.createTextNode(
      '[text ' +
        length +
        (labels.length ? ' | ' + labels.join(', ') : '') +
        ']',
    );
  }

  var clone = node.cloneNode();
  if (clone.nodeType === 1 && labels.length) {
    ((clone: any): Element).setAttribute('data-labels', labels.join(', '));
  }
  var childNodes = node.childNodes;
  for (var ii = 0; ii < childNodes.length; ii++) {
    clone.appendChild(anonymizeTextWithin(childNodes[ii], getNodeLabels));
  }

  return clone;
}

function getAnonymizedEditorDOM(
  node: Node,
  getNodeLabels?: (n: Node) => Array<string>,
): string {
  // grabbing the DOM content of the Draft editor
  let currentNode = node;
  while (currentNode) {
    if (
      currentNode instanceof Element &&
      currentNode.hasAttribute('contenteditable')
    ) {
      // found the Draft editor container
      return getAnonymizedDOM(currentNode, getNodeLabels);
    } else {
      currentNode = currentNode.parentNode;
    }
  }
  return 'Could not find contentEditable parent of node';
}

function getNodeLength(node: Node): number {
  return node.nodeValue === null
    ? node.childNodes.length
    : node.nodeValue.length;
}

/**
 * In modern non-IE browsers, we can support both forward and backward
 * selections.
 *
 * Note: IE10+ supports the Selection object, but it does not support
 * the `extend` method, which means that even in modern IE, it's not possible
 * to programatically create a backward selection. Thus, for all IE
 * versions, we use the old IE API to create our selections.
 */
function setDraftEditorSelection(
  selectionState: SelectionState,
  node: Node,
  blockKey: string,
  nodeStart: number,
  nodeEnd: number,
): void {
  // It's possible that the editor has been removed from the DOM but
  // our selection code doesn't know it yet. Forcing selection in
  // this case may lead to errors, so just bail now.
  if (!containsNode(document.documentElement, node)) {
    return;
  }

  var selection = global.getSelection();
  var anchorKey = selectionState.getAnchorKey();
  var anchorOffset = selectionState.getAnchorOffset();
  var focusKey = selectionState.getFocusKey();
  var focusOffset = selectionState.getFocusOffset();
  var isBackward = selectionState.getIsBackward();

  // IE doesn't support backward selection. Swap key/offset pairs.
  if (!selection.extend && isBackward) {
    var tempKey = anchorKey;
    var tempOffset = anchorOffset;
    anchorKey = focusKey;
    anchorOffset = focusOffset;
    focusKey = tempKey;
    focusOffset = tempOffset;
    isBackward = false;
  }

  var hasAnchor =
    anchorKey === blockKey &&
    nodeStart <= anchorOffset &&
    nodeEnd >= anchorOffset;

  var hasFocus =
    focusKey === blockKey && nodeStart <= focusOffset && nodeEnd >= focusOffset;

  // If the selection is entirely bound within this node, set the selection
  // and be done.
  if (hasAnchor && hasFocus) {
    protectedRemoveAllRanges(selection);
    addPointToSelection(
      selection,
      node,
      anchorOffset - nodeStart,
      selectionState,
    );
    addFocusToSelection(
      selection,
      node,
      focusOffset - nodeStart,
      selectionState,
    );
    return;
  }

  if (!isBackward) {
    // If the anchor is within this node, set the range start.
    if (hasAnchor) {
      protectedRemoveAllRanges(selection);
      addPointToSelection(
        selection,
        node,
        anchorOffset - nodeStart,
        selectionState,
      );
    }

    // If the focus is within this node, we can assume that we have
    // already set the appropriate start range on the selection, and
    // can simply extend the selection.
    if (hasFocus) {
      addFocusToSelection(
        selection,
        node,
        focusOffset - nodeStart,
        selectionState,
      );
    }
  } else {
    // If this node has the focus, set the selection range to be a
    // collapsed range beginning here. Later, when we encounter the anchor,
    // we'll use this information to extend the selection.
    if (hasFocus) {
      protectedRemoveAllRanges(selection);
      addPointToSelection(
        selection,
        node,
        focusOffset - nodeStart,
        selectionState,
      );
    }

    // If this node has the anchor, we may assume that the correct
    // focus information is already stored on the selection object.
    // We keep track of it, reset the selection range, and extend it
    // back to the focus point.
    if (hasAnchor) {
      var storedFocusNode = selection.focusNode;
      var storedFocusOffset = selection.focusOffset;

      protectedRemoveAllRanges(selection);
      addPointToSelection(
        selection,
        node,
        anchorOffset - nodeStart,
        selectionState,
      );

      // If selection has focusNode. Case when focus is off the editor.
      if (storedFocusNode) {
        addFocusToSelection(
          selection,
          storedFocusNode,
          storedFocusOffset,
          selectionState,
        );
      }
    }
  }
}

/**
 * Extend selection towards focus point.
 */
function addFocusToSelection(
  selection: Object,
  node: Node,
  offset: number,
  selectionState: SelectionState,
): void {
  const activeElement = getActiveElement();
  if (selection.extend && containsNode(activeElement, node)) {
    // If `extend` is called while another element has focus, an error is
    // thrown. We therefore disable `extend` if the active element is somewhere
    // other than the node we are selecting. This should only occur in Firefox,
    // since it is the only browser to support multiple selections.
    // See https://bugzilla.mozilla.org/show_bug.cgi?id=921444.

    // logging to catch bug that is being reported in t16250795
    if (offset > getNodeLength(node)) {
      // the call to 'selection.extend' is about to throw
      DraftJsDebugLogging.logSelectionStateFailure({
        anonymizedDom: getAnonymizedEditorDOM(node),
        extraParams: JSON.stringify({offset: offset}),
        selectionState: JSON.stringify(selectionState.toJS()),
      });
    }

    // logging to catch bug that is being reported in t18110632
    if (selection.type !== 'None') {
      // https://github.com/facebook/draft-js/pull/1192
      const nodeWasFocus = node === selection.focusNode;
      try {
        selection.extend(node, offset);
      } catch (e) {
        DraftJsDebugLogging.logSelectionStateFailure({
          anonymizedDom: getAnonymizedEditorDOM(node, function (n) {
            const labels = [];
            if (n === activeElement) {
              labels.push('active element');
            }
            if (n === selection.anchorNode) {
              labels.push('selection anchor node');
            }
            if (n === selection.focusNode) {
              labels.push('selection focus node');
            }
            return labels;
          }),
          extraParams: JSON.stringify(
            {
              activeElementName: activeElement ? activeElement.nodeName : null,
              nodeIsFocus: node === selection.focusNode,
              nodeWasFocus: nodeWasFocus,
              selectionRangeCount: selection.rangeCount,
              selectionAnchorNodeName: selection.anchorNode
                ? selection.anchorNode.nodeName
                : null,
              selectionAnchorOffset: selection.anchorOffset,
              selectionFocusNodeName: selection.focusNode
                ? selection.focusNode.nodeName
                : null,
              selectionFocusOffset: selection.focusOffset,
              message: e ? '' + e : null,
              offset: offset,
            },
            null,
            2,
          ),
          selectionState: JSON.stringify(selectionState.toJS(), null, 2),
        });
        // allow the error to be thrown -
        // better than continuing in a broken state
        throw e;
      }
    }
  } else {
    // IE doesn't support extend. This will mean no backward selection.
    // Extract the existing selection range and add focus to it.
    // Additionally, clone the selection range. IE11 throws an
    // InvalidStateError when attempting to access selection properties
    // after the range is detached.

    /*
      IE fails from upper functions with no error massage
      when selection has no range but program tracing end here practically.

      IE has time intervals when old selection no longer exists but
      new selection does not ready yet.

      In this intervals window.getSelection() returns
      completely empty selection.

      It's trying to get range from selection
      that has no any range at this code line.

      It's bad choice to do here time delay to work with selection when selection is ready.
      Because one more selection action can happen at this delay.

      It's fail for IE to work with selection in async style.

      Fixed by check of range count before try to extract a range.
    */
    if (selection.rangeCount > 0) {
      var range = selection.getRangeAt(0);
      range.setEnd(node, offset);
      protectedAddRage(selection, range.cloneRange());
    }
  }
}

function addPointToSelection(
  selection: Object,
  node: Node,
  offset: number,
  selectionState: SelectionState,
): void {
  var range = document.createRange();
  // logging to catch bug that is being reported in t16250795
  if (offset > getNodeLength(node)) {
    // in this case we know that the call to 'range.setStart' is about to throw
    DraftJsDebugLogging.logSelectionStateFailure({
      anonymizedDom: getAnonymizedEditorDOM(node),
      extraParams: JSON.stringify({offset: offset}),
      selectionState: JSON.stringify(selectionState.toJS()),
    });
  }
  range.setStart(node, offset);
  protectedAddRage(selection, range.cloneRange());
}

module.exports = setDraftEditorSelection;
