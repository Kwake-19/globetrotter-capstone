const { haversineDistanceKm } = require('../src/utils/geo');

describe('haversineDistanceKm', () => {
  it('is ~0 for the same point', () => {
    expect(haversineDistanceKm(3.8878, 11.5085, 3.8878, 11.5085)).toBeLessThan(0.001);
  });

  it('is symmetric', () => {
    const a = haversineDistanceKm(3.87, 11.50, 3.90, 11.52);
    const b = haversineDistanceKm(3.90, 11.52, 3.87, 11.50);
    expect(Math.abs(a - b)).toBeLessThan(1e-9);
  });

  it('matches a known distance (Yaounde -> Douala is ~200 km)', () => {
    const km = haversineDistanceKm(3.8480, 11.5021, 4.0511, 9.7679);
    expect(km).toBeGreaterThan(190);
    expect(km).toBeLessThan(215);
  });
});
