/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ContentBlock
 * @format
 * @flow
 */

'use strict';

import type {BlockNode, BlockNodeConfig, BlockNodeKey} from 'BlockNode';
import type {DraftBlockType} from 'DraftBlockType';
import type {DraftInlineStyle} from 'DraftInlineStyle';

const CharacterMetadata = require('CharacterMetadata');
const Immutable = require('immutable');

const findRangesImmutable = require('findRangesImmutable');

const {List, Map, OrderedSet, Record, Repeat} = Immutable;

const EMPTY_SET = OrderedSet();

const defaultRecord: BlockNodeConfig = {
  key: '',
  type: 'unstyled',
  text: '',
  characterList: List(),
  depth: 0,
  data: Map(),
  parentKey: '',
};

const ContentBlockRecord = Record(defaultRecord);

const decorateCharacterList = (config: BlockNodeConfig): BlockNodeConfig => {
  if (!config) {
    return config;
  }

  const {characterList, text} = config;

  if (text && !characterList) {
    config.characterList = List(Repeat(CharacterMetadata.EMPTY, text.length));
  }

  return config;
};

class ContentBlock extends ContentBlockRecord implements BlockNode {
  constructor(config: BlockNodeConfig) {
    super(decorateCharacterList(config));
  }

  getKey(): BlockNodeKey {
    return this.get('key');
  }

  getType(): DraftBlockType {
    return this.get('type');
  }

  getText(): string {
    return this.get('text');
  }

  getCharacterList(): List<CharacterMetadata> {
    return this.get('characterList');
  }

  getLength(): number {
    return this.getText().length;
  }

  getDepth(): number {
    return this.get('depth');
  }

  getData(): Map<any, any> {
    return this.get('data');
  }

  getParentKey(): string {
    return this.get('parentKey');
  }

  hasParent(): boolean {
    return this.getParentKey() !== '';
  }

  getInnerKey(): string {
    const key = this.getKey();
    const parts = key.split('/');

    return parts[parts.length - 1];
  }

  getInlineStyleAt(offset: number): DraftInlineStyle {
    var character = this.getCharacterList().get(offset);
    return character ? character.getStyle() : EMPTY_SET;
  }

  getEntityAt(offset: number): ?string {
    var character = this.getCharacterList().get(offset);
    return character ? character.getEntity() : null;
  }

  /**
   * Execute a callback for every contiguous range of styles within the block.
   */
  findStyleRanges(
    filterFn: (value: CharacterMetadata) => boolean,
    callback: (start: number, end: number) => void,
  ): void {
    findRangesImmutable(
      this.getCharacterList(),
      haveEqualStyle,
      filterFn,
      callback,
    );
  }

  /**
   * Execute a callback for every contiguous range of entities within the block.
   */
  findEntityRanges(
    filterFn: (value: CharacterMetadata) => boolean,
    callback: (start: number, end: number) => void,
  ): void {
    findRangesImmutable(
      this.getCharacterList(),
      haveEqualEntity,
      filterFn,
      callback,
    );
  }
}

function haveEqualStyle(
  charA: CharacterMetadata,
  charB: CharacterMetadata,
): boolean {
  return charA.getStyle() === charB.getStyle();
}

function haveEqualEntity(
  charA: CharacterMetadata,
  charB: CharacterMetadata,
): boolean {
  return charA.getEntity() === charB.getEntity();
}

module.exports = ContentBlock;
