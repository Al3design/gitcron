import { describe, expect, it } from 'vitest';
import { changeTitle } from '../assist/change-title';

describe('changeTitle', () => {
  it('convierte guiones a espacios y capitaliza solo la primera letra', () => {
    expect(changeTitle('retomar-trabajo-con-asistencia-contextual')).toBe(
      'Retomar trabajo con asistencia contextual',
    );
  });

  it('un id de una palabra', () => {
    expect(changeTitle('retomar')).toBe('Retomar');
  });

  it('uno con números', () => {
    expect(changeTitle('2026-q4')).toBe('2026 q4');
  });

  it('string vacío devuelve vacío', () => {
    expect(changeTitle('')).toBe('');
  });
});
