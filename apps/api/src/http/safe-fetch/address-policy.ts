/** `host`, `host:port`, `[v6]` or `[v6]:port` (a path, wildcard or scheme is not an allow-list entry). */
export const ALLOWED_HOST_PATTERN =
  /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)(:[0-9]{1,5})?$/;
