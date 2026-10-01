import { describe, expect, it } from 'vitest';
import {
  classifyOpenSpecVersion,
  compareSemver,
  isInstalledBehindCycle,
  OPENSPEC_CYCLE_TARGET_VERSION,
  parseSemver,
  SUPPORTED_OPENSPEC_VERSIONS,
} from '../openspec-version';

describe('parseSemver', () => {
  it('parsea MAJOR.MINOR.PATCH', () => {
    expect(parseSemver('1.5.0')).toEqual({ major: 1, minor: 5, patch: 0 });
    expect(parseSemver('1.8.0')).toEqual({ major: 1, minor: 8, patch: 0 });
    expect(parseSemver('1.11.0')).toEqual({ major: 1, minor: 11, patch: 0 });
  });

  it('descarta el prerelease', () => {
    expect(parseSemver('1.6.0-beta.1')).toEqual({ major: 1, minor: 6, patch: 0 });
  });

  it('rechaza lo que no es versión o contiene basura al final', () => {
    expect(parseSemver('basura')).toBeNull();
    expect(parseSemver('1.8.0basura')).toBeNull();
    expect(parseSemver('1.8.0.4')).toBeNull();
    expect(parseSemver('')).toBeNull();
    expect(parseSemver(null)).toBeNull();
    expect(parseSemver(undefined)).toBeNull();
  });
});

describe('compareSemver', () => {
  it('compara por major, minor y patch', () => {
    expect(compareSemver(parseSemver('1.5.0')!, parseSemver('1.8.0')!)).toBeLessThan(0);
    expect(compareSemver(parseSemver('1.8.0')!, parseSemver('1.5.0')!)).toBeGreaterThan(0);
    expect(compareSemver(parseSemver('1.11.0')!, parseSemver('1.11.0')!)).toBe(0);
  });
});

describe('classifyOpenSpecVersion (rango ≥ 1.5.0)', () => {
  it('declara la versión objetivo del ciclo y el rango soportado del proyecto', () => {
    expect(OPENSPEC_CYCLE_TARGET_VERSION).toBe('1.14.0');
    expect(SUPPORTED_OPENSPEC_VERSIONS).toEqual({ min: '1.5.0' });
  });

  it('clasifica supported dentro del rango', () => {
    expect(classifyOpenSpecVersion('1.5.0')).toBe('supported');
    expect(classifyOpenSpecVersion('1.7.0')).toBe('supported');
    expect(classifyOpenSpecVersion('1.8.0')).toBe('supported');
    expect(classifyOpenSpecVersion('1.9.0')).toBe('supported');
    expect(classifyOpenSpecVersion('1.11.0')).toBe('supported');
    expect(classifyOpenSpecVersion('1.12.0')).toBe('supported');
    expect(classifyOpenSpecVersion('1.13.0')).toBe('supported');
  });

  it('clasifica too-old por debajo del mínimo', () => {
    expect(classifyOpenSpecVersion('1.4.9')).toBe('too-old');
    expect(classifyOpenSpecVersion('0.17.2')).toBe('too-old');
  });

  it('clasifica supported por encima del mínimo sin límite superior', () => {
    expect(classifyOpenSpecVersion('1.12.1')).toBe('supported');
    expect(classifyOpenSpecVersion('2.0.0')).toBe('supported');
  });

  it('clasifica unknown cuando no puede interpretar la versión', () => {
    expect(classifyOpenSpecVersion(null)).toBe('unknown');
    expect(classifyOpenSpecVersion('')).toBe('unknown');
    expect(classifyOpenSpecVersion('no-es-versión')).toBe('unknown');
  });

  it('respeta un rango custom', () => {
    expect(classifyOpenSpecVersion('1.8.0', { min: '1.8.0', max: '1.8.0' })).toBe('supported');
    expect(classifyOpenSpecVersion('1.7.0', { min: '1.8.0', max: '1.8.0' })).toBe('too-old');
  });
});


describe('isInstalledBehindCycle', () => {
  it('detecta correctamente si la versión instalada está por debajo de la versión del ciclo declarada', () => {
    // Caso borde: 1.5.0 contra ciclo 1.14.0 (nueve minors de distancia, dentro de rango soportado)
    expect(isInstalledBehindCycle('1.5.0')).toBe(true);
    expect(isInstalledBehindCycle('1.11.0')).toBe(true);
    expect(isInstalledBehindCycle('1.12.0')).toBe(true);
    expect(isInstalledBehindCycle('1.12.9')).toBe(true);
    expect(isInstalledBehindCycle('1.13.0')).toBe(true);
    // Caso igual a igual: 1.14.0 contra 1.14.0 no debe avisar nada
    expect(isInstalledBehindCycle('1.14.0')).toBe(false);
    // Casos posteriores no avisan en esta función
    expect(isInstalledBehindCycle('1.14.1')).toBe(false);
    expect(isInstalledBehindCycle('1.15.0')).toBe(false);
    expect(isInstalledBehindCycle(null)).toBe(false);
    expect(isInstalledBehindCycle(undefined)).toBe(false);
  });
});
