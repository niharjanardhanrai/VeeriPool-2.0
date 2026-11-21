// Fair pricing — cost sharing, not a taxi meter. VeriPool drivers are
// students in private cars, so the fare only ever recovers what the trip
// actually costs (fuel + wear); the driver makes no profit and nobody pays
// for distance they didn't travel.
//
// The algorithm (per-segment equal split):
//   1. A posted route is a chain of stops; each leg between two stops costs
//      legKm × COST_PER_KM.
//   2. On every leg, that cost is split equally between everyone in the car
//      on that leg — the driver counts as one share, each booked seat as one.
//   3. A rider's fare is the sum of their seat-shares over the legs they're
//      on board for, times their seat count.
//
// Why this is fair:
//   • Pay for what you use — only the legs between your boarding and
//     drop-off stop count.
//   • Shared legs are split equally — two people on the same leg pay the same.
//   • More riders = cheaper for everyone — a new booking can only lower the
//     per-seat share on the legs it overlaps, never raise anyone else's.
//   • No surge, no profit — the total collected is always less than the
//     trip's cost, because the driver always carries one share themselves.
//   • Price cap — a rider never pays more than the fare quoted when they
//     booked, even if someone else cancels later (the driver absorbs that).
const FUEL_PRICE_PER_LITRE = Number(process.env.FUEL_PRICE_PER_LITRE) || 103; // petrol, Karnataka 2026
const CAR_MILEAGE_KMPL = Number(process.env.CAR_MILEAGE_KMPL) || 15;
const WEAR_PER_KM = Number(process.env.WEAR_PER_KM) || 1.5; // tyres, servicing

const COST_PER_KM = Math.round((FUEL_PRICE_PER_LITRE / CAR_MILEAGE_KMPL + WEAR_PER_KM) * 100) / 100;

const rupees = (n) => Math.round(n);

// legs: [{ km }]; bookings: [{ seats, boardIndex, alightIndex }] where a
// booking rides legs boardIndex .. alightIndex-1 (stop indices).
// Returns the per-booking fares plus a per-leg breakdown.
function splitCosts(legs, bookings, costPerKm = COST_PER_KM) {
  const segments = legs.map((leg, i) => {
    const onBoard = bookings
      .filter((b) => b.boardIndex <= i && i < b.alightIndex)
      .reduce((sum, b) => sum + b.seats, 0);
    const cost = leg.km * costPerKm;
    return { km: leg.km, cost, seatsBooked: onBoard, perSeat: cost / (onBoard + 1) };
  });

  const fares = bookings.map((b) => {
    let fare = 0;
    for (let i = b.boardIndex; i < b.alightIndex; i++) fare += segments[i].perSeat * b.seats;
    return fare;
  });

  const tripCost = segments.reduce((s, x) => s + x.cost, 0);
  const collected = fares.reduce((s, f) => s + f, 0);
  return {
    fares,
    segments,
    tripCost,
    collected,
    driverShare: tripCost - collected,
  };
}

// What `candidate` would pay if they booked now, alongside the bookings
// already on the ride.
function quote(legs, bookings, candidate, costPerKm = COST_PER_KM) {
  const { fares } = splitCosts(legs, [...bookings, candidate], costPerKm);
  return rupees(fares[fares.length - 1]);
}

// Live fares for the active bookings, capped at what each was quoted.
function liveFares(legs, bookings, costPerKm = COST_PER_KM) {
  const { fares, ...rest } = splitCosts(legs, bookings, costPerKm);
  return {
    ...rest,
    fares: fares.map((f, i) => {
      const live = rupees(f);
      const cap = bookings[i].quotedFare;
      return typeof cap === 'number' ? Math.min(live, cap) : live;
    }),
  };
}

// On-demand requests (the original request -> accept flow) are a single
// group in the car with the driver, so the same rule reduces to: trip cost
// split between the driver and the requested seats.
function soloFare(distanceKm, seats, costPerKm = COST_PER_KM) {
  return rupees(((distanceKm * costPerKm) / (seats + 1)) * seats);
}

module.exports = { COST_PER_KM, splitCosts, quote, liveFares, soloFare };
