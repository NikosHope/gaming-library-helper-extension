# Product records and grouping (library schema v5)

A canonical record is not necessarily a primary game. Each store reference can describe a
`game`, `component`, `tool`, `auxiliary` entitlement, or `unknown` product. A component subtype
can be beta, mode, DLC, demo, localization, emulator core, or other. Original store IDs, titles,
resolved/unresolved title status, ownership, import time, URL and source-ignore flags remain intact.
Classification labels are separate from the original provider title. Reviewed classifications retain
source links and primary/community confidence. They are local product rules, not IGDB/RAWG mappings.

## Conservative identity

Only resolved primary-game references can automatically merge through exact normalized titles or
explicit aliases. Components, tools, auxiliary entries and unknowns cannot supply cross-store
ownership badges or hiding decisions. A reviewed component parent is an explicit store + product ID,
not a guessed title match or another item in the same license package.

The presentation groups a component with a saved parent only through this explicit parent identity.
An absent parent creates a presentation header with no canonical ID or ownership reference. Owning
that component never proves ownership of the parent. Search includes component labels, original
provider titles and IDs, and keeps the containing group. Category filtering uses the actual records,
so a component-only header does not increase the games count.

Schema v4 and earlier migrate on a copy to v5; annotations and stable IDs survive. Mixed legacy
records containing a primary game and a newly identified non-game are separated, preserving the
primary identity and annotations and every source reference. The old `games` collection name and
snapshot `gameCount` field remain for compatibility; `gameCount` is the number of source records,
not the number of primary games. `countOwned` counts owned resolved primary games; `countProducts`
reports all categories separately. `groupLibrary` does not mutate persisted ownership.

`exportLibrary`/`importLibrary` provide a pure versioned backup codec, preserving classification,
relations, annotations and ownership. They perform no writes or network requests. Import rejects
unsupported versions and duplicate/inconsistent IDs. There is no new runtime import command or
file dialog in this backend change.

## Reviewed exceptions, checked 2026-10-08

| Steam ID                           | Local category     | Confirmed parent / evidence                                                                                                                                                                            |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 520                                | beta               | 440, [Valve TF2 Beta announcement](https://www.teamfortress.com/post.php?id=4721)                                                                                                                      |
| 350470                             | beta               | 379720, [Valve release announcement](https://store.steampowered.com/oldnews/21368) links the beta and DOOM                                                                                             |
| 223060                             | single-player mode | 200170; this named mode belongs to Worms Revolution, corroborated by the [Team17 single-player reply](https://steamcommunity.com/app/200170/discussions/0/810922320185960359/) and historical app name |
| 1118310                            | tool               | [Libretro's Steam description](https://store.steampowered.com/app/1118310/RetroArch/) describes an emulator/frontend framework despite the catalog game type                                           |
| 407270                             | localization       | parent omitted pending primary identity evidence                                                                                                                                                       |
| 503590                             | DLC                | parent omitted pending primary identity evidence                                                                                                                                                       |
| 1222636, 1227462, 1227466, 1227469 | emulator cores     | parent omitted; sharing a RetroArch package alone is insufficient                                                                                                                                      |
| 2130210                            | tool               | last known Steam Mobile App name; community confidence                                                                                                                                                 |

Historical names above are attributed to each corresponding `https://steamdb.info/app/<id>/`;
these labels do not change `titleStatus` to store-confirmed resolved. Non-obvious parent associations
are deliberately absent until primary evidence supports the exact IDs.

Five community-observed Paradox dummy apps are auxiliary package markers, with no parent ownership
or playable-DLC claim: [944280](https://barter.vg/i/83118/json/),
[947020](https://barter.vg/i/80610/json/), [947180](https://barter.vg/i/80612/json/),
[947220](https://barter.vg/i/80613/json/), [2473901](https://barter.vg/i/349427/json/).
Their classification explicitly says community evidence. Probable markers 478730/550502,
849500's reported PDF depot, and Rockstar IDs 3575130/3575160/3575340 remain unknown;
no package/depot association is converted into a confirmed game name or relationship.

## Collection and validation

Steam capture retains every authenticated owned app ID, including confirmed non-games. Public
metadata only classifies those owned IDs and cannot add ownership. Unrecognized types remain unknown.
DLC/demo without a confirmed parent remains a standalone component. Catalog redirects cannot own
their destination, and failed/partial captures preserve the previous snapshot.

Fictional tests cover migration without lost identities, classification, backup round trips, explicit
parent grouping and unknown-title preservation. Private account checkpoints are not included in the
public repository. This model does not establish acceptance of a future UI or a signed release.

## Package co-membership evidence, checked 2026-10-09

The version-1 public catalog in `src/core/steam-package-evidence.ts` records reviewed public Steam app observations and their independently checked SteamDB package associations. Each observation keeps its own unknown name/type/status, namespaced app/package identities, all selected associated app IDs, package title, community source URL, retrieval date and unknown parent. Shared-package membership is neither a DLC parent relationship nor an alias, ownership, executable, platform, genre or performance fact. The GTA Trilogy association retains all three known games; the Party Robes and Other Side of the Coin associations retain their multiple DLC members. The L.A. Noire snapshot explicitly notes indexed-source freshness limits.

This is separate, versioned public evidence, with a read-only unknown-product projection. It does not add fields to the persisted library schema, mutate store titles/classifications, or add owned products. A newer real app title/type can resolve a record while its dated package observation remains available. Catalog copies cannot mutate the bundled evidence. Future catalog versions and guessed parents/classifications are rejected by its strict schema. A future UI needs its own acceptance; the model does not establish installed UI behavior.
