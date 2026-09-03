# EagleView Sandbox Test Addresses (free — no charges)

While `EAGLEVIEW_ENV` = `sandbox`, every EagleView pull is free and uses mock data.
Sandbox only resolves the fixed addresses below — real addresses return nothing until you
flip `EAGLEVIEW_ENV` to `production` (which bills per report). **Keep it on `sandbox` for dev.**

## Quick Roof Estimate — Property Data API (button in Roof Measurements)
Sandbox covers a ~1.5 sq-mi area in **Omaha, NE**. Any of these work:

- 4220 Barker Ave, Omaha, NE 68105
- 822 S 49th St, Omaha, NE 68106
- 5157 Jones St, Omaha, NE 68106
- 1015 S 46th St, Omaha, NE 68106
- 5616 Walnut St, Omaha, NE 68106

## Full Reports — Measurement Orders API (EagleView Reports panel)
Each report type is keyed to specific sandbox addresses.

**Roof report** (Order Roof Report):
- 4800 Floral Park Rd, Brandywine, MD 20613
- 1919 W 9th Ave, Spokane, WA 99204
- 19355 Iris St, Chugiak, AK 99567

**Full House — Roof + Siding** (Full House button — fills roof + siding + soffit in one pull):
- 116 South Maple Street, Oak Harbor, OH 43449
- 92 Winthrop St, Brooklyn, NY 11225
- 10772 N Scott St, Alexandria, IN 46001

**Walls, Windows & Doors** (Walls, Windows & Doors button):
- 176 Anderson Ave, Plain City, OH 43064
- 200 Northlind Dr, Defiance, MO 63341
- 452 W Stansifer Ave, Clarksville, IN 47129

## When you're ready for real properties
Change the `EAGLEVIEW_ENV` Supabase secret from `sandbox` to `production`. From then on,
pulls use real addresses and **cost money** (Property Data per pull; Measurement Orders per report).
