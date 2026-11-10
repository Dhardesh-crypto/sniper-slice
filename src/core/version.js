// A version in the address of every model, sound and texture ("?v=7"): those files keep their
// names when they change, so the site can let browsers keep them for a long time (public/_headers)
// and still get a new one when it's needed. Raise it whenever a file under public/models,
// public/sounds or public/textures is replaced.
export const ASSET_VERSION = '?v=1';

// The address of a file under public/ ("models/tank.glb"), with the site's base and the version.
export const asset = (path) => `${import.meta.env.BASE_URL}${path}${ASSET_VERSION}`;
