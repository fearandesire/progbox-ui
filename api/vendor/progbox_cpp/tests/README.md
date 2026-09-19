# NET progression parity fixtures

`net_parity.cpp` executes the production v321/v43 headers with a controlled draw
stream. CTest compares all 15 final ratings, BBGM-derived OVR, god bonus and draw
count against `net_parity_cases.json`. It also checks 64-bit run-seed preservation
in god records. Normal builds retain per-run mt19937 draws; no cross-language seed
identity is assumed. Legacy v41 is unchanged.

```sh
pnpm build:engine
ctest --test-dir api/vendor/progbox_cpp/build --output-on-failure
```

The same JSON bytes are checked into NoEyeTest's behavioral suite. Its tests run
both complete browser scripts with BBGM storage/lifecycle mocks and pinned BBGM
`limitRating`, `ovr` and `randInt` implementations. BBGM is pinned at
`0ae7a104d541ad0a4806de083819b19735cbf301`; Published NET is pinned at
`972f9d3c08476bd91276ea7327b0972dfba3a382`. JSON `references` records source SHA-256s.
Those tests do not substitute for real BBGM browser lifecycle acceptance.

`net_loader_precision` calls the production `load_players` function through a
translation unit that renames its CLI entry point. A normalized raw fixture with
20 three-point attempts over 3 games must reconstruct exactly 20 attempts and
remain eligible for the efficiency pool. It also verifies double precision for
advanced rates and availability, fractional normalized ratings until progression,
unchanged float normalization and integer rating truncation for legacy input,
and actual `Analytics::export_godprogs` output: seeds above 2^53 and at the signed
64-bit maximum must be exact decimal strings in JSON.

## Format

Each case specifies `version` (`v321` or `v43`), entering-season `age`, `attrs` in
`ALL_ATTRS` order, normalized per-game `stats`, and the Candidate preparation
`pool`. `draws` supplies successive uniforms in `[0,1)`; `drawFallback` supplies
subsequent values. Every uniform or integer draw consumes one entry. Integer
draws use the pinned BBGM formula `floor(u * (1 + max - min)) + min`, including
inverted Published ranges at extreme PER. `expected` contains `attrs`, `ovr`,
`godBonus` (null for no god progression) and `drawCount`.

Coverage includes fractional flooring, unchanged height, rating clamps, soft
ceilings, minutes/attempt cutoffs, heterogeneous reliability-weighted pools,
negative and zero PER, age boundaries, god bonus endpoints and chance thresholds,
Published physical skips and shared maximum mutation, zero-max fallback,
OVR-capping branches, and extreme-PER inverted ranges. The shared golden inputs
use exactly representable per-game statistics, while the real-loader regression
covers non-binary fractional division and the 20-attempt eligibility boundary.
Normalized NET statistics use doubles throughout; legacy input retains its
historical float normalization. Integer outputs require exact equality. The
suite does not claim same-seed sequences are identical across languages.

## Regeneration

`generate-net-parity.cjs` evaluates the actual scripts and the pinned helpers
exported by NoEyeTest's harness. Candidate cases call the actual `preparePool`
and `progressPlayer`; Published cases execute the entire progression loop with
notifications intercepted. No progression formula is duplicated in the generator.
The Published source hash must match the pinned revision. Regenerate only when
an intentional contract change has been reviewed, then copy the identical JSON
into NoEyeTest and run both suites:

```sh
node api/vendor/progbox_cpp/tests/generate-net-parity.cjs \
  "$NET_CHECKOUT/src/NoEyeTest.js" \
  "$NET_CHECKOUT/tests/fixtures/published-972f9d3.js" \
  "$NET_CHECKOUT/tests/helpers/run-script.cjs"
```

The source path for Published may instead name another byte-identical checkout
of that commit. The current artifact has 137 cases and SHA-256
`0f23503bfce12d5a73376fbc37a649ea202a916642daf8b621eb9fdeea3822f5`.
