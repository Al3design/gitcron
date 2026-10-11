// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { Stack, Row, PlainList, Text } from '../index';

describe('components/ui - Piezas compartidas de maquetación y texto', () => {
  describe('Stack', () => {
    it('renderiza un contenedor en columna con gap opcional y pasa props HTML', () => {
      const ref = createRef<HTMLDivElement>();
      const { container } = render(
        <Stack ref={ref} gap="2" className="custom-stack" id="my-stack" aria-label="stack-test">
          <span>Item 1</span>
          <span>Item 2</span>
        </Stack>
      );
      const el = container.firstElementChild as HTMLElement;
      expect(el).toBe(ref.current);
      expect(el.tagName).toBe('DIV');
      expect(el.id).toBe('my-stack');
      expect(el.getAttribute('aria-label')).toBe('stack-test');
      expect(el.className).toContain('stack');
      expect(el.className).toContain('gap2');
      expect(el.className).toContain('custom-stack');
      expect(screen.getByText('Item 1')).toBeDefined();
    });

    it('soporta las variantes de gap 1, 2, 3 y 4', () => {
      const { container: c1 } = render(<Stack gap="1" />);
      expect((c1.firstElementChild as HTMLElement).className).toContain('gap1');

      const { container: c3 } = render(<Stack gap="3" />);
      expect((c3.firstElementChild as HTMLElement).className).toContain('gap3');

      const { container: c4 } = render(<Stack gap="4" />);
      expect((c4.firstElementChild as HTMLElement).className).toContain('gap4');
    });

    it('soporta la prop polimórfica as (ej: section)', () => {
      const { container } = render(<Stack as="section" gap="2" />);
      expect((container.firstElementChild as HTMLElement).tagName).toBe('SECTION');
    });
  });

  describe('Row', () => {
    it('renderiza una fila alineada al centro con gap y wrap opcional', () => {
      const ref = createRef<HTMLDivElement>();
      const { container } = render(
        <Row ref={ref} gap="2" wrap className="custom-row" data-testid="row-test">
          <span>Row 1</span>
        </Row>
      );
      const el = screen.getByTestId('row-test');
      expect(el).toBe(ref.current);
      expect(el.tagName).toBe('DIV');
      expect(el.className).toContain('row');
      expect(el.className).toContain('gap2');
      expect(el.className).toContain('wrap');
      expect(el.className).toContain('custom-row');
    });
  });

  describe('PlainList', () => {
    it('renderiza un elemento <ul> sin viñetas con gap opcional', () => {
      const ref = createRef<HTMLUListElement>();
      const { container } = render(
        <PlainList ref={ref} gap="1" className="custom-list">
          <li>Elemento A</li>
        </PlainList>
      );
      const el = container.firstElementChild as HTMLElement;
      expect(el).toBe(ref.current);
      expect(el.tagName).toBe('UL');
      expect(el.className).toContain('plainList');
      expect(el.className).toContain('gap1');
      expect(el.className).toContain('custom-list');
    });
  });

  describe('Text', () => {
    it('renderiza variante secondary-xs por omisión en span o etiqueta personalizada', () => {
      const ref = createRef<HTMLElement>();
      render(
        <Text ref={ref} variant="secondary-xs" as="p" className="custom-text">
          Texto secundario
        </Text>
      );
      const el = screen.getByText('Texto secundario');
      expect(el).toBe(ref.current);
      expect(el.tagName).toBe('P');
      expect(el.className).toContain('secondaryXs');
      expect(el.className).toContain('custom-text');
    });

    it('renderiza variante mono-xs', () => {
      render(
        <Text variant="mono-xs" as="em">
          Texto técnico
        </Text>
      );
      const el = screen.getByText('Texto técnico');
      expect(el.tagName).toBe('EM');
      expect(el.className).toContain('monoXs');
    });
  });
});
