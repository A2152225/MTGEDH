import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HandGallery } from '../src/components/HandGallery';
import { HandCardContextMenu } from '../src/components/HandCardContextMenu';
import { ZoneCardContextMenu } from '../src/components/ZoneCardContextMenu';
import type { CardCostAdjustment } from '../../shared/src';

const optCard = {
  id: 'opt_hand',
  name: 'Opt',
  type_line: 'Instant',
  oracle_text: 'Scry 1. Draw a card.',
  mana_cost: '{1}{U}',
};

const costReduction: CardCostAdjustment = {
  originalCost: '{1}{U}',
  adjustedCost: '{U}',
  adjustment: -1,
  genericAdjustment: -1,
  sources: ['Sapphire Medallion: -{1}'],
  isIncrease: false,
};

const costIncrease: CardCostAdjustment = {
  originalCost: '{U}',
  adjustedCost: '{1}{U}',
  adjustment: 1,
  genericAdjustment: 1,
  sources: ['Sphere of Resistance: +{1}'],
  isIncrease: true,
};

describe('cost adjustment display surfaces', () => {
  it('renders hand gallery cost adjustment badges from shared CardCostAdjustment data', () => {
    const html = renderToStaticMarkup(React.createElement(HandGallery, {
      cards: [optCard],
      imagePref: 'small',
      costAdjustments: { opt_hand: costReduction },
    }));

    expect(html).toContain('Mana cost reduced from {1}{U} to {U}');
    expect(html).toContain('Sapphire Medallion: -{1}');
  });

  it('renders adjusted costs in the hand card context menu header and cast row', () => {
    const html = renderToStaticMarkup(React.createElement(HandCardContextMenu, {
      card: optCard,
      x: 10,
      y: 10,
      onClose: () => undefined,
      onCast: () => undefined,
      costAdjustment: costIncrease,
    }));

    expect(html).toContain('Cost:');
    expect(html).toContain('{U}');
    expect(html).toContain('{1}{U}');
    expect(html).toContain('Sphere of Resistance: +{1}');
  });

  it('renders adjusted costs in zone context menus for command-zone casting', () => {
    const html = renderToStaticMarkup(React.createElement(ZoneCardContextMenu, {
      card: optCard,
      zone: 'commander',
      x: 10,
      y: 10,
      onClose: () => undefined,
      onCast: () => undefined,
      costAdjustment: costReduction,
    }));

    expect(html).toContain('Cost:');
    expect(html).toContain('{1}{U}');
    expect(html).toContain('{U}');
    expect(html).toContain('Cast Spell');
  });
});
