// Only the resolver settings are read by dependency-cruiser (this is not a real webpack build).
module.exports = {
  resolve: { alias: { '@': `${__dirname}/../apps/web/src` } },
};
