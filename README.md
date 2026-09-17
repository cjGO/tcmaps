# Maproom

Browse 200 maps with four spawn setups each, keep your favorites, and copy a plain-text list to send in a message. No accounts, database, API, or environment variables needed.

## Collections

The default **Current rotation** tab cycles through PNGs in `current_rotation`, sorted by filename in numeric order. The exact original PNG filename appears above each image; names embedded in the image are not used. Use the previous/next buttons or left/right arrow keys. These PNGs are included directly in the build, so commit this folder when deploying and rebuild after changing it.

The **Review maps** tab contains the map/spawn browser and saved keep list. Switching tabs preserves your position in both collections.

## Run

Requires Node.js 20.19+ (or 22.12+).

```sh
cd rate_maps
npm install
npm run dev
```

- Left/right arrows cycle maps. Up/down arrows cycle spawn setups. Clickable controls work on mobile. Shortcuts pause while editing text.
- Click **Keep this setup** to add a map/spawn pair. You can keep multiple spawn setups for the same map. Each kept setup gets a badge.
- Click **Kept · Remove**, or the × beside a list item, to remove it. Click an item to revisit it.
- Click **Copy list**, then paste into a message. The visible text box also supports manual copying if clipboard access is unavailable.

Example message:

```text
Keep list
scn_test_001 | top_left
scn_test_001 | left_middle
scn_test_014 | bottom_left
```

The selections are saved in this browser's local storage. They survive refreshes and reopening the same site, but do not sync between devices or browsers. Clearing site data deletes them. Nothing is submitted automatically: users must send the copied message. If browser storage is unavailable, the page warns the user to copy before leaving. Existing star ratings are not converted to keep selections.

## Deploy to Vercel

Upload this directory to a Git repository and import it into Vercel. If uploading the parent repository, set **Root Directory** to `rate_maps`. The included configuration builds with `npm run build` and serves `dist` as a static site. No Redis, serverless functions, CSV, or secrets are required. Old Redis environment variables can be removed if upgrading the previous version.

## Images

All 800 optimized images are included in `public/maps`, with the collection manifest in `lib/maps.json`. The original `temp_folder` is not needed for deployment. Biome descriptors are ignored in map identifiers.

`npm run dev` and `npm run build` automatically regenerate images from this project’s `temp_folder` when it exists. Restart the dev server after replacing source images. Deployments without that folder use the prepared images. Image URLs include a content version so replaced maps bypass old browser caches.

To regenerate manually after changing source images (or append `-- /path/to/folder` to use another folder):

```sh
npm run prepare:maps
```

## Production build

```sh
npm run build
npm run preview
```
