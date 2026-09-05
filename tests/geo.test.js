const { haversineDistanceKm } = require('../src/utils/geo');

describe('haversineDistanceKm', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistanceKm(3.848, 11.502, 3.848, 11.502)).toBeCloseTo(0, 5);
  });

  it('matches the known great-circle distance between Paris and London (~344 km)', () => {
    const distance = haversineDistanceKm(48.8566, 2.3522, 51.5074, -0.1278);
    expect(distance).toBeGreaterThan(330);
    expect(distance).toBeLessThan(360);
  });

  it('matches the known great-circle distance between New York and Los Angeles (~3936 km)', () => {
    const distance = haversineDistanceKm(40.7128, -74.0060, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(3900);
    expect(distance).toBeLessThan(3970);
  });

  it('is symmetric regardless of point order', () => {
    const a = haversineDistanceKm(3.870794, 11.523396, 3.883283, 11.525308);
    const b = haversineDistanceKm(3.883283, 11.525308, 3.870794, 11.523396);
    expect(a).toBeCloseTo(b, 10);
  });
});
