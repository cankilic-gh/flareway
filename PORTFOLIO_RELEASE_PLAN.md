# Deferred release and portfolio plan

Do not execute this plan until the user has played and accepted the local Flareway build.

## 1. Flareway release

- Re-run lint, strict typecheck, unit tests, production build and full Chrome/WebKit E2E on the accepted commit.
- Perform a staged/tracked-file secret scan and verify the asset license ledger.
- Create public GitHub repository `cankilic-gh/flareway` with `main` as default.
- Push without force and verify local/remote SHA equality.
- Monitor GitHub Actions to terminal success.
- Create/link the personal Vercel project `flareway`.
- Deploy the exact accepted SHA to production.
- Add the public domain `flareway.thegridbase.com`.
- Configure only the exact Cloudflare DNS record requested by Vercel, preserving other records.
- Verify public DNS, provider detection, certificate, HTTPS, GLB delivery and normal/test API isolation.
- Run a clean public browser smoke for Landing Challenge, Takeoff Practice, Tutorial and GLB fallback.

## 2. TheGridBase portfolio update

Update the existing TheGridBase portfolio only after both public game URLs are confirmed healthy.

Add two separate game/project cards:

### Steerageway

- URL: https://steerageway.thegridbase.com
- GitHub: https://github.com/cankilic-gh/steerageway
- Positioning: browser-native recreational boat handling simulator with Mission and Free Cruise, wind/current/waves, docking/beaching and a Blender-authored hero boat.
- Use a current production screenshot showing the V20-inspired boat and water.

### Flareway

- Planned URL: https://flareway.thegridbase.com
- Planned GitHub: https://github.com/cankilic-gh/flareway
- Positioning: browser-native takeoff and landing game centered on smooth touchdowns, runway alignment, PAPI and seeded crosswind/gust conditions.
- Use a current production screenshot from final approach or touchdown, not a Blender studio render.

Portfolio acceptance:

- Cards match the live TheGridBase design system.
- Both project and GitHub links work.
- Responsive layout passes desktop and mobile checks.
- No exaggerated training, certification or realism claims.
- Portfolio deployment and custom domain remain healthy.
