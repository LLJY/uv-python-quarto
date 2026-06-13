// deno:https://jsr.io/@std/path/1.0.8/_os.ts
var isWindows = globalThis.Deno?.build.os === "windows" || globalThis.navigator?.platform?.startsWith("Win") || globalThis.process?.platform?.startsWith("win") || false;

// deno:https://jsr.io/@std/path/1.0.8/_common/assert_path.ts
function assertPath(path) {
  if (typeof path !== "string") {
    throw new TypeError(`Path must be a string, received "${JSON.stringify(path)}"`);
  }
}

// deno:https://jsr.io/@std/path/1.0.8/_common/basename.ts
function stripSuffix(name, suffix) {
  if (suffix.length >= name.length) {
    return name;
  }
  const lenDiff = name.length - suffix.length;
  for (let i = suffix.length - 1; i >= 0; --i) {
    if (name.charCodeAt(lenDiff + i) !== suffix.charCodeAt(i)) {
      return name;
    }
  }
  return name.slice(0, -suffix.length);
}
function lastPathSegment(path, isSep, start = 0) {
  let matchedNonSeparator = false;
  let end = path.length;
  for (let i = path.length - 1; i >= start; --i) {
    if (isSep(path.charCodeAt(i))) {
      if (matchedNonSeparator) {
        start = i + 1;
        break;
      }
    } else if (!matchedNonSeparator) {
      matchedNonSeparator = true;
      end = i + 1;
    }
  }
  return path.slice(start, end);
}
function assertArgs(path, suffix) {
  assertPath(path);
  if (path.length === 0) return path;
  if (typeof suffix !== "string") {
    throw new TypeError(`Suffix must be a string, received "${JSON.stringify(suffix)}"`);
  }
}

// deno:https://jsr.io/@std/path/1.0.8/_common/strip_trailing_separators.ts
function stripTrailingSeparators(segment, isSep) {
  if (segment.length <= 1) {
    return segment;
  }
  let end = segment.length;
  for (let i = segment.length - 1; i > 0; i--) {
    if (isSep(segment.charCodeAt(i))) {
      end = i;
    } else {
      break;
    }
  }
  return segment.slice(0, end);
}

// deno:https://jsr.io/@std/path/1.0.8/_common/constants.ts
var CHAR_UPPERCASE_A = 65;
var CHAR_LOWERCASE_A = 97;
var CHAR_UPPERCASE_Z = 90;
var CHAR_LOWERCASE_Z = 122;
var CHAR_DOT = 46;
var CHAR_FORWARD_SLASH = 47;
var CHAR_BACKWARD_SLASH = 92;
var CHAR_COLON = 58;

// deno:https://jsr.io/@std/path/1.0.8/posix/_util.ts
function isPosixPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH;
}

// deno:https://jsr.io/@std/path/1.0.8/posix/basename.ts
function basename(path, suffix = "") {
  assertArgs(path, suffix);
  const lastSegment = lastPathSegment(path, isPosixPathSeparator);
  const strippedSegment = stripTrailingSeparators(lastSegment, isPosixPathSeparator);
  return suffix ? stripSuffix(strippedSegment, suffix) : strippedSegment;
}

// deno:https://jsr.io/@std/path/1.0.8/windows/_util.ts
function isPosixPathSeparator2(code) {
  return code === CHAR_FORWARD_SLASH;
}
function isPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}
function isWindowsDeviceRoot(code) {
  return code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z || code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z;
}

// deno:https://jsr.io/@std/path/1.0.8/windows/basename.ts
function basename2(path, suffix = "") {
  assertArgs(path, suffix);
  let start = 0;
  if (path.length >= 2) {
    const drive = path.charCodeAt(0);
    if (isWindowsDeviceRoot(drive)) {
      if (path.charCodeAt(1) === CHAR_COLON) start = 2;
    }
  }
  const lastSegment = lastPathSegment(path, isPathSeparator, start);
  const strippedSegment = stripTrailingSeparators(lastSegment, isPathSeparator);
  return suffix ? stripSuffix(strippedSegment, suffix) : strippedSegment;
}

// deno:https://jsr.io/@std/path/1.0.8/basename.ts
function basename3(path, suffix = "") {
  return isWindows ? basename2(path, suffix) : basename(path, suffix);
}

// deno:https://jsr.io/@std/path/1.0.8/_common/dirname.ts
function assertArg(path) {
  assertPath(path);
  if (path.length === 0) return ".";
}

// deno:https://jsr.io/@std/path/1.0.8/posix/dirname.ts
function dirname(path) {
  assertArg(path);
  let end = -1;
  let matchedNonSeparator = false;
  for (let i = path.length - 1; i >= 1; --i) {
    if (isPosixPathSeparator(path.charCodeAt(i))) {
      if (matchedNonSeparator) {
        end = i;
        break;
      }
    } else {
      matchedNonSeparator = true;
    }
  }
  if (end === -1) {
    return isPosixPathSeparator(path.charCodeAt(0)) ? "/" : ".";
  }
  return stripTrailingSeparators(path.slice(0, end), isPosixPathSeparator);
}

// deno:https://jsr.io/@std/path/1.0.8/windows/dirname.ts
function dirname2(path) {
  assertArg(path);
  const len = path.length;
  let rootEnd = -1;
  let end = -1;
  let matchedSlash = true;
  let offset = 0;
  const code = path.charCodeAt(0);
  if (len > 1) {
    if (isPathSeparator(code)) {
      rootEnd = offset = 1;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) break;
        }
        if (j < len && j !== last) {
          last = j;
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            last = j;
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j === len) {
              return path;
            }
            if (j !== last) {
              rootEnd = offset = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code)) {
      if (path.charCodeAt(1) === CHAR_COLON) {
        rootEnd = offset = 2;
        if (len > 2) {
          if (isPathSeparator(path.charCodeAt(2))) rootEnd = offset = 3;
        }
      }
    }
  } else if (isPathSeparator(code)) {
    return path;
  }
  for (let i = len - 1; i >= offset; --i) {
    if (isPathSeparator(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    if (rootEnd === -1) return ".";
    else end = rootEnd;
  }
  return stripTrailingSeparators(path.slice(0, end), isPosixPathSeparator2);
}

// deno:https://jsr.io/@std/path/1.0.8/dirname.ts
function dirname3(path) {
  return isWindows ? dirname2(path) : dirname(path);
}

// deno:https://jsr.io/@std/path/1.0.8/_common/from_file_url.ts
function assertArg3(url) {
  url = url instanceof URL ? url : new URL(url);
  if (url.protocol !== "file:") {
    throw new TypeError(`URL must be a file URL: received "${url.protocol}"`);
  }
  return url;
}

// deno:https://jsr.io/@std/path/1.0.8/posix/from_file_url.ts
function fromFileUrl(url) {
  url = assertArg3(url);
  return decodeURIComponent(url.pathname.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
}

// deno:https://jsr.io/@std/path/1.0.8/windows/from_file_url.ts
function fromFileUrl2(url) {
  url = assertArg3(url);
  let path = decodeURIComponent(url.pathname.replace(/\//g, "\\").replace(/%(?![0-9A-Fa-f]{2})/g, "%25")).replace(/^\\*([A-Za-z]:)(\\|$)/, "$1\\");
  if (url.hostname !== "") {
    path = `\\\\${url.hostname}${path}`;
  }
  return path;
}

// deno:https://jsr.io/@std/path/1.0.8/from_file_url.ts
function fromFileUrl3(url) {
  return isWindows ? fromFileUrl2(url) : fromFileUrl(url);
}

// deno:https://jsr.io/@std/path/1.0.8/_common/normalize.ts
function assertArg4(path) {
  assertPath(path);
  if (path.length === 0) return ".";
}

// deno:https://jsr.io/@std/path/1.0.8/_common/normalize_string.ts
function normalizeString(path, allowAboveRoot, separator, isPathSeparator2) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (isPathSeparator2(code)) break;
    else code = CHAR_FORWARD_SLASH;
    if (isPathSeparator2(code)) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== CHAR_DOT || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length === 2 || res.length === 1) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) res += `${separator}..`;
          else res = "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) res += separator + path.slice(lastSlash + 1, i);
        else res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

// deno:https://jsr.io/@std/path/1.0.8/posix/normalize.ts
function normalize(path) {
  assertArg4(path);
  const isAbsolute3 = isPosixPathSeparator(path.charCodeAt(0));
  const trailingSeparator = isPosixPathSeparator(path.charCodeAt(path.length - 1));
  path = normalizeString(path, !isAbsolute3, "/", isPosixPathSeparator);
  if (path.length === 0 && !isAbsolute3) path = ".";
  if (path.length > 0 && trailingSeparator) path += "/";
  if (isAbsolute3) return `/${path}`;
  return path;
}

// deno:https://jsr.io/@std/path/1.0.8/posix/join.ts
function join(...paths) {
  if (paths.length === 0) return ".";
  paths.forEach((path) => assertPath(path));
  const joined = paths.filter((path) => path.length > 0).join("/");
  return joined === "" ? "." : normalize(joined);
}

// deno:https://jsr.io/@std/path/1.0.8/windows/normalize.ts
function normalize2(path) {
  assertArg4(path);
  const len = path.length;
  let rootEnd = 0;
  let device;
  let isAbsolute3 = false;
  const code = path.charCodeAt(0);
  if (len > 1) {
    if (isPathSeparator(code)) {
      isAbsolute3 = true;
      if (isPathSeparator(path.charCodeAt(1))) {
        let j = 2;
        let last = j;
        for (; j < len; ++j) {
          if (isPathSeparator(path.charCodeAt(j))) break;
        }
        if (j < len && j !== last) {
          const firstPart = path.slice(last, j);
          last = j;
          for (; j < len; ++j) {
            if (!isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            last = j;
            for (; j < len; ++j) {
              if (isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j === len) {
              return `\\\\${firstPart}\\${path.slice(last)}\\`;
            } else if (j !== last) {
              device = `\\\\${firstPart}\\${path.slice(last, j)}`;
              rootEnd = j;
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else if (isWindowsDeviceRoot(code)) {
      if (path.charCodeAt(1) === CHAR_COLON) {
        device = path.slice(0, 2);
        rootEnd = 2;
        if (len > 2) {
          if (isPathSeparator(path.charCodeAt(2))) {
            isAbsolute3 = true;
            rootEnd = 3;
          }
        }
      }
    }
  } else if (isPathSeparator(code)) {
    return "\\";
  }
  let tail;
  if (rootEnd < len) {
    tail = normalizeString(path.slice(rootEnd), !isAbsolute3, "\\", isPathSeparator);
  } else {
    tail = "";
  }
  if (tail.length === 0 && !isAbsolute3) tail = ".";
  if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) {
    tail += "\\";
  }
  if (device === void 0) {
    if (isAbsolute3) {
      if (tail.length > 0) return `\\${tail}`;
      else return "\\";
    }
    return tail;
  } else if (isAbsolute3) {
    if (tail.length > 0) return `${device}\\${tail}`;
    else return `${device}\\`;
  }
  return device + tail;
}

// deno:https://jsr.io/@std/path/1.0.8/windows/join.ts
function join2(...paths) {
  paths.forEach((path) => assertPath(path));
  paths = paths.filter((path) => path.length > 0);
  if (paths.length === 0) return ".";
  let needsReplace = true;
  let slashCount = 0;
  const firstPart = paths[0];
  if (isPathSeparator(firstPart.charCodeAt(0))) {
    ++slashCount;
    const firstLen = firstPart.length;
    if (firstLen > 1) {
      if (isPathSeparator(firstPart.charCodeAt(1))) {
        ++slashCount;
        if (firstLen > 2) {
          if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
          else {
            needsReplace = false;
          }
        }
      }
    }
  }
  let joined = paths.join("\\");
  if (needsReplace) {
    for (; slashCount < joined.length; ++slashCount) {
      if (!isPathSeparator(joined.charCodeAt(slashCount))) break;
    }
    if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
  }
  return normalize2(joined);
}

// deno:https://jsr.io/@std/path/1.0.8/join.ts
function join3(...paths) {
  return isWindows ? join2(...paths) : join(...paths);
}

// deno:https://jsr.io/@std/path/1.0.8/posix/resolve.ts
function resolve(...pathSegments) {
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    let path;
    if (i >= 0) path = pathSegments[i];
    else {
      const { Deno: Deno2 } = globalThis;
      if (typeof Deno2?.cwd !== "function") {
        throw new TypeError("Resolved a relative path without a current working directory (CWD)");
      }
      path = Deno2.cwd();
    }
    assertPath(path);
    if (path.length === 0) {
      continue;
    }
    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = isPosixPathSeparator(path.charCodeAt(0));
  }
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
  if (resolvedAbsolute) {
    if (resolvedPath.length > 0) return `/${resolvedPath}`;
    else return "/";
  } else if (resolvedPath.length > 0) return resolvedPath;
  else return ".";
}

// deno:https://jsr.io/@std/path/1.0.8/_common/relative.ts
function assertArgs2(from, to) {
  assertPath(from);
  assertPath(to);
  if (from === to) return "";
}

// deno:https://jsr.io/@std/path/1.0.8/posix/relative.ts
function relative(from, to) {
  assertArgs2(from, to);
  from = resolve(from);
  to = resolve(to);
  if (from === to) return "";
  let fromStart = 1;
  const fromEnd = from.length;
  for (; fromStart < fromEnd; ++fromStart) {
    if (!isPosixPathSeparator(from.charCodeAt(fromStart))) break;
  }
  const fromLen = fromEnd - fromStart;
  let toStart = 1;
  const toEnd = to.length;
  for (; toStart < toEnd; ++toStart) {
    if (!isPosixPathSeparator(to.charCodeAt(toStart))) break;
  }
  const toLen = toEnd - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (isPosixPathSeparator(to.charCodeAt(toStart + i))) {
          return to.slice(toStart + i + 1);
        } else if (i === 0) {
          return to.slice(toStart + i);
        }
      } else if (fromLen > length) {
        if (isPosixPathSeparator(from.charCodeAt(fromStart + i))) {
          lastCommonSep = i;
        } else if (i === 0) {
          lastCommonSep = 0;
        }
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    else if (isPosixPathSeparator(fromCode)) lastCommonSep = i;
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || isPosixPathSeparator(from.charCodeAt(i))) {
      if (out.length === 0) out += "..";
      else out += "/..";
    }
  }
  if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
  else {
    toStart += lastCommonSep;
    if (isPosixPathSeparator(to.charCodeAt(toStart))) ++toStart;
    return to.slice(toStart);
  }
}

// deno:https://jsr.io/@std/path/1.0.8/windows/resolve.ts
function resolve2(...pathSegments) {
  let resolvedDevice = "";
  let resolvedTail = "";
  let resolvedAbsolute = false;
  for (let i = pathSegments.length - 1; i >= -1; i--) {
    let path;
    const { Deno: Deno2 } = globalThis;
    if (i >= 0) {
      path = pathSegments[i];
    } else if (!resolvedDevice) {
      if (typeof Deno2?.cwd !== "function") {
        throw new TypeError("Resolved a drive-letter-less path without a current working directory (CWD)");
      }
      path = Deno2.cwd();
    } else {
      if (typeof Deno2?.env?.get !== "function" || typeof Deno2?.cwd !== "function") {
        throw new TypeError("Resolved a relative path without a current working directory (CWD)");
      }
      path = Deno2.cwd();
      if (path === void 0 || path.slice(0, 3).toLowerCase() !== `${resolvedDevice.toLowerCase()}\\`) {
        path = `${resolvedDevice}\\`;
      }
    }
    assertPath(path);
    const len = path.length;
    if (len === 0) continue;
    let rootEnd = 0;
    let device = "";
    let isAbsolute3 = false;
    const code = path.charCodeAt(0);
    if (len > 1) {
      if (isPathSeparator(code)) {
        isAbsolute3 = true;
        if (isPathSeparator(path.charCodeAt(1))) {
          let j = 2;
          let last = j;
          for (; j < len; ++j) {
            if (isPathSeparator(path.charCodeAt(j))) break;
          }
          if (j < len && j !== last) {
            const firstPart = path.slice(last, j);
            last = j;
            for (; j < len; ++j) {
              if (!isPathSeparator(path.charCodeAt(j))) break;
            }
            if (j < len && j !== last) {
              last = j;
              for (; j < len; ++j) {
                if (isPathSeparator(path.charCodeAt(j))) break;
              }
              if (j === len) {
                device = `\\\\${firstPart}\\${path.slice(last)}`;
                rootEnd = j;
              } else if (j !== last) {
                device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                rootEnd = j;
              }
            }
          }
        } else {
          rootEnd = 1;
        }
      } else if (isWindowsDeviceRoot(code)) {
        if (path.charCodeAt(1) === CHAR_COLON) {
          device = path.slice(0, 2);
          rootEnd = 2;
          if (len > 2) {
            if (isPathSeparator(path.charCodeAt(2))) {
              isAbsolute3 = true;
              rootEnd = 3;
            }
          }
        }
      }
    } else if (isPathSeparator(code)) {
      rootEnd = 1;
      isAbsolute3 = true;
    }
    if (device.length > 0 && resolvedDevice.length > 0 && device.toLowerCase() !== resolvedDevice.toLowerCase()) {
      continue;
    }
    if (resolvedDevice.length === 0 && device.length > 0) {
      resolvedDevice = device;
    }
    if (!resolvedAbsolute) {
      resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
      resolvedAbsolute = isAbsolute3;
    }
    if (resolvedAbsolute && resolvedDevice.length > 0) break;
  }
  resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, "\\", isPathSeparator);
  return resolvedDevice + (resolvedAbsolute ? "\\" : "") + resolvedTail || ".";
}

// deno:https://jsr.io/@std/path/1.0.8/windows/relative.ts
function relative2(from, to) {
  assertArgs2(from, to);
  const fromOrig = resolve2(from);
  const toOrig = resolve2(to);
  if (fromOrig === toOrig) return "";
  from = fromOrig.toLowerCase();
  to = toOrig.toLowerCase();
  if (from === to) return "";
  let fromStart = 0;
  let fromEnd = from.length;
  for (; fromStart < fromEnd; ++fromStart) {
    if (from.charCodeAt(fromStart) !== CHAR_BACKWARD_SLASH) break;
  }
  for (; fromEnd - 1 > fromStart; --fromEnd) {
    if (from.charCodeAt(fromEnd - 1) !== CHAR_BACKWARD_SLASH) break;
  }
  const fromLen = fromEnd - fromStart;
  let toStart = 0;
  let toEnd = to.length;
  for (; toStart < toEnd; ++toStart) {
    if (to.charCodeAt(toStart) !== CHAR_BACKWARD_SLASH) break;
  }
  for (; toEnd - 1 > toStart; --toEnd) {
    if (to.charCodeAt(toEnd - 1) !== CHAR_BACKWARD_SLASH) break;
  }
  const toLen = toEnd - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === CHAR_BACKWARD_SLASH) {
          return toOrig.slice(toStart + i + 1);
        } else if (i === 2) {
          return toOrig.slice(toStart + i);
        }
      }
      if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === CHAR_BACKWARD_SLASH) {
          lastCommonSep = i;
        } else if (i === 2) {
          lastCommonSep = 3;
        }
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    else if (fromCode === CHAR_BACKWARD_SLASH) lastCommonSep = i;
  }
  if (i !== length && lastCommonSep === -1) {
    return toOrig;
  }
  let out = "";
  if (lastCommonSep === -1) lastCommonSep = 0;
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_BACKWARD_SLASH) {
      if (out.length === 0) out += "..";
      else out += "\\..";
    }
  }
  if (out.length > 0) {
    return out + toOrig.slice(toStart + lastCommonSep, toEnd);
  } else {
    toStart += lastCommonSep;
    if (toOrig.charCodeAt(toStart) === CHAR_BACKWARD_SLASH) ++toStart;
    return toOrig.slice(toStart, toEnd);
  }
}

// deno:https://jsr.io/@std/path/1.0.8/relative.ts
function relative3(from, to) {
  return isWindows ? relative2(from, to) : relative(from, to);
}

// deno:https://jsr.io/@std/path/1.0.8/resolve.ts
function resolve3(...pathSegments) {
  return isWindows ? resolve2(...pathSegments) : resolve(...pathSegments);
}

// src/uv-python.ts
var quarto;
var kEngineName = "uv-python";
var kCellLanguage = "python";
var kOutputProtocolVersion = "uv-python.output-events/v1";
var kInlineExecutionSentinel = [
  "",
  "```{python}",
  "#| include: false",
  "#| eval: false",
  "# uv-python inline-only execution sentinel",
  "```",
  ""
].join("\n");
var extensionDir = dirname3(fromFileUrl3(import.meta.url));
var optionKeys = [
  "eval",
  "echo",
  "include",
  "output",
  "warning",
  "error"
];
var tableOptionKeys = [
  "label",
  "tbl-cap"
];
var figureOptionKeys = [
  "label",
  "fig-width",
  "fig-height",
  "fig-dpi",
  "fig-format",
  "fig-cap",
  "fig-alt",
  "fig-align",
  "fig-link",
  "width",
  "height"
];
var documentFigureOptionKeys = [
  "fig-width",
  "fig-height",
  "fig-dpi",
  "fig-format"
];
var optionSummary = "eval (true/false), echo (true/false/fenced), include (true/false), output (true/false/asis), warning (true/false), error (true/false)";
var documentOptionSummary = `${optionSummary}, fig-width (number), fig-height (number), fig-dpi (number), fig-format (png/svg/retina)`;
var figureOptionSummary = "label (tbl-* table labels or fig-* figure labels), tbl-cap (string), fig-width (number), fig-height (number), fig-dpi (number), fig-format (png/svg/retina), fig-cap (string or string list), fig-alt (string), fig-align (default/left/right/center), fig-link (string), width (string/number), height (string/number)";
var chunkOptionSummary = `${optionSummary}, ${figureOptionSummary}`;
var defaultExecutionOptions = () => ({
  eval: true,
  echo: false,
  include: true,
  output: true,
  warning: true,
  error: false
});
var defaultFigureSettings = () => ({
  format: "png"
});
var uvPythonEngineDiscovery = {
  init: (quartoAPI) => {
    quarto = quartoAPI;
  },
  name: kEngineName,
  defaultExt: ".qmd",
  defaultYaml: () => [
    `engine: ${kEngineName}`
  ],
  defaultContent: () => [
    "```{" + kCellLanguage + "}",
    "print('Hello from uv-python!')",
    "```"
  ],
  validExtensions: () => [],
  claimsFile: (_file, _ext) => false,
  claimsLanguage: (_language, _firstClass) => {
    return false;
  },
  canFreeze: false,
  generatesFigures: true,
  launch: (context) => {
    return {
      name: uvPythonEngineDiscovery.name,
      canFreeze: uvPythonEngineDiscovery.canFreeze,
      async markdownForFile(file) {
        return await markdownForFileWithInlineSentinel(file);
      },
      target: async (file, _quiet, markdown) => {
        const md = markdown ?? await markdownForFileWithInlineSentinel(file);
        const target = {
          source: file,
          input: file,
          markdown: md,
          metadata: quarto.markdownRegex.extractYaml(md.value)
        };
        return Promise.resolve(target);
      },
      partitionedMarkdown: async (file) => {
        return quarto.markdownRegex.partition((await markdownForFileWithInlineSentinel(file)).value);
      },
      execute: async (options) => {
        const chunks = await quarto.markdownRegex.breakQuartoMd(options.target.markdown);
        const documentPath = resolve3(options.cwd, options.target.source);
        const documentCwd = dirname3(documentPath);
        const projectRoot = resolve3(context.dir);
        const supportDirName = quarto.path.inputFilesDir(documentPath);
        const supportDir = join3(documentCwd, supportDirName);
        const engineFigureRoot = join3(supportDir, kEngineName);
        const figureDir = join3(engineFigureRoot, figureArtifactFormatNamespace(options));
        const documentOptions = documentExecutionOptions(options);
        const documentFigure = documentFigureSettings(options);
        const optionalRequirements = uvPythonWithRequirements(options);
        const runnerChunks = [];
        const runnerItems = [];
        const cellChunkNumbers = /* @__PURE__ */ new Map();
        const parsedChunks = /* @__PURE__ */ new Map();
        const parsedMarkdownCells = /* @__PURE__ */ new Map();
        const inlineOptions = /* @__PURE__ */ new Map();
        let previousChunkIndex = -1;
        for (const cell of chunks.cells) {
          if (isPythonCell(cell)) {
            const chunkNumber = runnerChunks.length;
            cellChunkNumbers.set(cell, chunkNumber);
            const parsed = parseChunk(cell, documentOptions, documentFigure);
            parsedChunks.set(cell, parsed);
            runnerChunks.push({
              index: chunkNumber,
              code: parsed.code,
              options: parsed.options,
              figure: figureSettingsForRunner(parsed.figure)
            });
            runnerItems.push({
              kind: "chunk",
              chunkIndex: chunkNumber
            });
            previousChunkIndex = chunkNumber;
          } else if (isMarkdownCell(cell)) {
            parsedMarkdownCells.set(cell, parseMarkdownCellInlineExpressions(cell.sourceVerbatim.value, (code) => {
              const inlineIndex = inlineOptions.size;
              const options2 = {
                ...documentOptions,
                error: false
              };
              inlineOptions.set(inlineIndex, options2);
              runnerItems.push({
                kind: "inline",
                inlineIndex,
                chunkIndex: previousChunkIndex,
                code,
                options: options2
              });
              return inlineIndex;
            }));
          }
        }
        let runnerResponse = {
          protocol: kOutputProtocolVersion,
          events: []
        };
        if (runnerItems.length > 0) {
          if (runnerChunks.length > 0) {
            await clearActiveFigureDir(figureDir, engineFigureRoot, supportDir);
          }
          runnerResponse = await runPythonRunner({
            chunks: runnerChunks,
            items: runnerItems,
            documentPath,
            documentCwd,
            projectRoot,
            figureDir,
            tempDir: options.tempDir,
            params: pythonParams(options),
            executeInfo: quartoExecuteInfo(options, documentPath),
            optionalRequirements
          });
        }
        const eventsByChunk = /* @__PURE__ */ new Map();
        const eventsByInline = /* @__PURE__ */ new Map();
        for (const event of runnerResponse.events) {
          if (event.inlineIndex !== void 0) {
            let inlineEvents = eventsByInline.get(event.inlineIndex);
            if (inlineEvents === void 0) {
              inlineEvents = [];
              eventsByInline.set(event.inlineIndex, inlineEvents);
            }
            inlineEvents.push(event);
            continue;
          }
          let chunkEvents = eventsByChunk.get(event.chunkIndex);
          if (chunkEvents === void 0) {
            chunkEvents = {
              events: [],
              figures: []
            };
            eventsByChunk.set(event.chunkIndex, chunkEvents);
          }
          chunkEvents.events.push(event);
          if (event.kind === "figure") {
            const path = stringPayloadField(event, "path");
            chunkEvents.figures.push({
              path,
              mime: stringPayloadField(event, "mime", false),
              index: numericMetadataField(event, "figureIndex") ?? chunkEvents.figures.length
            });
          }
        }
        const processedCells = [];
        const supporting = /* @__PURE__ */ new Set();
        for (const cell of chunks.cells) {
          if (isMarkdownCell(cell)) {
            const parsedMarkdown = parsedMarkdownCells.get(cell);
            processedCells.push(parsedMarkdown === void 0 ? cell.sourceVerbatim.value : renderMarkdownCellWithInline(parsedMarkdown, eventsByInline, inlineOptions));
            continue;
          }
          if (!isPythonCell(cell)) {
            processedCells.push(cell.sourceVerbatim.value);
            continue;
          }
          const chunkNumber = cellChunkNumbers.get(cell);
          if (chunkNumber === void 0) {
            processedCells.push(cell.sourceVerbatim.value);
            continue;
          }
          const parsed = parsedChunks.get(cell);
          if (parsed === void 0) {
            throw new Error(`uv-python internal error: missing parsed chunk ${chunkNumber}.`);
          }
          const output = eventsByChunk.get(chunkNumber);
          processedCells.push(renderChunkMarkdown(parsed, output, documentCwd));
          if (output?.figures.length) {
            supporting.add(supportDir);
          }
        }
        return {
          engine: kEngineName,
          markdown: processedCells.join(""),
          supporting: Array.from(supporting),
          filters: []
        };
      },
      dependencies: (_options) => {
        return Promise.resolve({
          includes: {}
        });
      },
      postprocess: (_options) => Promise.resolve()
    };
  }
};
var uv_python_default = uvPythonEngineDiscovery;
async function markdownForFileWithInlineSentinel(file) {
  const original = Deno.readTextFileSync(file);
  const markdown = await markdownWithInlineExecutionSentinel(original);
  if (markdown === original) {
    return quarto.mappedString.fromFile(file);
  }
  return quarto.mappedString.fromString(markdown, file);
}
async function markdownWithInlineExecutionSentinel(markdown) {
  if (!hasExecutableInlineExpression(markdown)) {
    return markdown;
  }
  const chunks = await quarto.markdownRegex.breakQuartoMd(markdown);
  if (chunks.cells.some((cell) => isPythonCell(cell))) {
    return markdown;
  }
  return `${markdown.replace(/[ \t]*$/, "")}${kInlineExecutionSentinel}`;
}
function isPythonCell(cell) {
  return typeof cell.cell_type === "object" && cell.cell_type.language.toLowerCase() === kCellLanguage;
}
function isMarkdownCell(cell) {
  return cell.cell_type === "markdown";
}
function parseMarkdownCellInlineExpressions(markdown, allocateInline) {
  const frontMatter = frontMatterRange(markdown);
  if (frontMatter === void 0) {
    return {
      segments: parseInlineSegments(markdown, allocateInline)
    };
  }
  const before = markdown.slice(0, frontMatter.end);
  const after = markdown.slice(frontMatter.end);
  return {
    segments: [
      ...before ? [
        {
          kind: "text",
          markdown: before
        }
      ] : [],
      ...parseInlineSegments(after, allocateInline)
    ]
  };
}
function frontMatterRange(markdown) {
  if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
    return void 0;
  }
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  return match === null ? void 0 : {
    end: match[0].length
  };
}
function parseInlineSegments(markdown, allocateInline) {
  const segments = [];
  let position = 0;
  let fence;
  const listContexts = [];
  while (position < markdown.length) {
    const lineEnd = markdown.indexOf("\n", position);
    const nextPosition = lineEnd === -1 ? markdown.length : lineEnd + 1;
    const line = markdown.slice(position, nextPosition);
    const lineWithoutNewline = line.replace(/\r?\n$/, "");
    const lineStartsListItem = markdownListMarkerStart(lineWithoutNewline) !== void 0;
    const listContext = currentMarkdownListContextForLine(lineWithoutNewline, listContexts);
    const explicitContainerContentLine = stripMarkdownContainerPrefixes(lineWithoutNewline);
    const containerContentLine = lineStartsListItem ? explicitContainerContentLine : stripListContinuationIndent(explicitContainerContentLine, listContext);
    if (fence !== void 0) {
      pushTextSegment(segments, line);
      if (closesMarkdownFence(containerContentLine, fence)) {
        fence = void 0;
      }
      position = nextPosition;
      continue;
    }
    const openingFence = markdownFenceStart(containerContentLine);
    if (openingFence !== void 0) {
      fence = openingFence;
      pushTextSegment(segments, line);
      position = nextPosition;
      continue;
    }
    if (isIndentedCodeLine(containerContentLine)) {
      pushTextSegment(segments, line);
      position = nextPosition;
      continue;
    }
    parseInlineCodeSpanSegments(line, allocateInline, segments);
    position = nextPosition;
  }
  return segments;
}
function parseInlineCodeSpanSegments(markdown, allocateInline, segments) {
  let position = 0;
  while (position < markdown.length) {
    const tickStart = markdown.indexOf("`", position);
    if (tickStart === -1) {
      pushTextSegment(segments, markdown.slice(position));
      return;
    }
    const tickEnd = endOfRun(markdown, tickStart, "`");
    const tickCount = tickEnd - tickStart;
    const fence = "`".repeat(tickCount);
    const closing = markdown.indexOf(fence, tickEnd);
    if (closing === -1) {
      pushTextSegment(segments, markdown.slice(position));
      return;
    }
    if (tickCount !== 1) {
      pushTextSegment(segments, markdown.slice(position, closing + tickCount));
      position = closing + tickCount;
      continue;
    }
    const content = markdown.slice(tickEnd, closing);
    if (content.startsWith("{python}") && !content.startsWith("{{python}}")) {
      const code = content.slice("{python}".length).trim();
      if (code.length === 0) {
        throw new Error("uv-python inline expression cannot be empty.");
      }
      pushTextSegment(segments, markdown.slice(position, tickStart));
      segments.push({
        kind: "inline",
        inlineIndex: allocateInline(code)
      });
    } else {
      pushTextSegment(segments, markdown.slice(position, closing + 1));
    }
    position = closing + 1;
  }
}
function hasExecutableInlineExpression(markdown) {
  let found = false;
  parseMarkdownCellInlineExpressions(markdown, (_code) => {
    found = true;
    return 0;
  });
  return found;
}
function markdownFenceStart(line) {
  const match = line.match(/^(?: {0,3})(`{3,}|~{3,})/);
  if (match === null) {
    return void 0;
  }
  return {
    marker: match[1][0],
    length: match[1].length
  };
}
function closesMarkdownFence(line, fence) {
  const match = line.match(/^(?: {0,3})(`+|~+)[ \t]*$/);
  return match !== null && match[1][0] === fence.marker && match[1].length >= fence.length;
}
function stripMarkdownContainerPrefixes(line) {
  let rest = line;
  let strippedAny = false;
  while (true) {
    const blockquote = rest.match(/^(?: {0,3})>[ \t]?/);
    if (blockquote !== null) {
      rest = rest.slice(blockquote[0].length);
      strippedAny = true;
      continue;
    }
    const list = rest.match(/^((?: {0,3})(?:[-+*]|\d{1,9}[.)]))([ \t]*|$)/);
    if (list !== null) {
      const padding = list[2] ?? "";
      rest = rest.slice(list[1].length + (padding.length > 0 ? 1 : 0));
      strippedAny = true;
      continue;
    }
    break;
  }
  return strippedAny ? rest : line;
}
function currentMarkdownListContextForLine(line, contexts) {
  if (/^[ \t]*$/.test(line)) {
    return contexts[contexts.length - 1];
  }
  const marker = markdownListMarkerStart(line);
  if (marker !== void 0) {
    while (contexts.length > 0 && marker.markerIndent < contexts[contexts.length - 1].contentIndent) {
      contexts.pop();
    }
    contexts.push(marker);
    return marker;
  }
  const indent = leadingSpaceCount(line);
  while (contexts.length > 0 && indent < contexts[contexts.length - 1].contentIndent) {
    contexts.pop();
  }
  return contexts[contexts.length - 1];
}
function markdownListMarkerStart(line) {
  const match = line.match(/^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/);
  if (match === null) {
    return void 0;
  }
  const markerIndent = match[1].length;
  const markerEnd = markerIndent + match[2].length;
  const padding = match[3] ?? "";
  const paddingWidth = leadingIndentWidth(padding, markerEnd);
  const contentIndent = paddingWidth > 4 ? markerEnd + 1 : markerEnd + paddingWidth;
  return {
    markerIndent,
    contentIndent
  };
}
function stripListContinuationIndent(line, context) {
  if (context === void 0) {
    return line;
  }
  let index = 0;
  while (index < context.contentIndent && index < line.length && line[index] === " ") {
    index += 1;
  }
  return line.slice(index);
}
function leadingSpaceCount(line) {
  const match = line.match(/^ */);
  return match === null ? 0 : match[0].length;
}
function leadingIndentWidth(indentation, startColumn) {
  let column = startColumn;
  for (const character of indentation) {
    if (character === "	") {
      column += 4 - column % 4;
    } else {
      column += 1;
    }
  }
  return column - startColumn;
}
function isIndentedCodeLine(line) {
  return /^(?: {4}|\t)/.test(line);
}
function endOfRun(markdown, start, marker) {
  let end = start + 1;
  while (end < markdown.length && markdown[end] === marker) {
    end += 1;
  }
  return end;
}
function pushTextSegment(segments, markdown) {
  if (!markdown) {
    return;
  }
  const previous = segments[segments.length - 1];
  if (previous?.kind === "text") {
    previous.markdown += markdown;
    return;
  }
  segments.push({
    kind: "text",
    markdown
  });
}
function documentExecutionOptions(options) {
  const merged = defaultExecutionOptions();
  validateExplicitExecuteDefaults(options.target.metadata, options.format.identifier?.["target-format"]);
  const formatExecute = objectRecord(options.format.execute);
  if (formatExecute !== void 0) {
    for (const key of optionKeys) {
      if (key in formatExecute) {
        merged[key] = parseOptionValue(key, formatExecute[key]);
      }
    }
  }
  return merged;
}
function documentFigureSettings(options) {
  const merged = defaultFigureSettings();
  const formatExecute = objectRecord(options.format.execute);
  if (formatExecute !== void 0) {
    for (const key of documentFigureOptionKeys) {
      if (key in formatExecute) {
        applyFigureSetting(merged, key, formatExecute[key]);
      }
    }
  }
  return merged;
}
function validateExplicitExecuteDefaults(metadata, targetFormat) {
  const root = objectRecord(metadata);
  if (root === void 0) {
    return;
  }
  validateExecuteObject(root.execute, "document-level execute");
  const format3 = objectRecord(root.format);
  if (format3 === void 0) {
    return;
  }
  const activeFormat = typeof targetFormat === "string" ? targetFormat : void 0;
  const formatNames = activeFormat !== void 0 ? [
    activeFormat
  ] : Object.keys(format3);
  for (const name of formatNames) {
    const formatOptions = objectRecord(format3[name]);
    if (formatOptions !== void 0 && "execute" in formatOptions) {
      validateExecuteObject(formatOptions.execute, `format '${name}' execute`);
    }
  }
}
function validateExecuteObject(value, sourceName) {
  if (value === void 0) {
    return;
  }
  const execute = objectRecord(value);
  if (execute === void 0) {
    throw new Error(`uv-python ${sourceName} must be a YAML mapping.`);
  }
  for (const key of Object.keys(execute)) {
    if (!isSupportedOptionKey(key)) {
      if (isDocumentFigureOptionKey(key)) {
        applyFigureSetting(defaultFigureSettings(), key, execute[key]);
        continue;
      }
      throw new Error(`Unsupported uv-python ${sourceName} option '${key}'. Supported options: ${documentOptionSummary}.`);
    }
    parseOptionValue(key, execute[key]);
  }
}
function objectRecord(value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return void 0;
}
function parseChunk(cell, documentOptions, documentFigure) {
  const options = {
    ...documentOptions
  };
  const table = {};
  const figure = {
    ...documentFigure
  };
  const sourceOptions = cell.options ?? {};
  const sourceOptionKeys = /* @__PURE__ */ new Set();
  const echoFencedOptionLines = [];
  for (const key of Object.keys(sourceOptions)) {
    if (!isSupportedChunkOptionKey(key)) {
      throw new Error(`Unsupported uv-python chunk option '${key}'. Supported options: ${chunkOptionSummary}.`);
    }
  }
  for (const key of optionKeys) {
    if (key in sourceOptions) {
      options[key] = parseOptionValue(key, sourceOptions[key]);
    }
  }
  for (const key of tableOptionKeys) {
    if (key in sourceOptions) {
      applyTableOrFigureOption(table, figure, key, sourceOptions[key]);
    }
  }
  for (const key of figureOptionKeys) {
    if (key in sourceOptions && key !== "label") {
      applyFigureOption(figure, key, sourceOptions[key]);
    }
  }
  const codeLines = [];
  for (const line of cell.source.value.split(/\r?\n/)) {
    if (/^\s*#\|/.test(line) && !/^\s*#\|\s*[^:]+:\s*/.test(line)) {
      continue;
    }
    const match = line.match(/^\s*#\|\s*([^:]+):\s*(.*?)\s*$/);
    if (!match) {
      codeLines.push(line);
      continue;
    }
    const key = match[1].trim();
    const value = match[2].trim();
    if (!isSupportedChunkOptionKey(key)) {
      throw new Error(`Unsupported uv-python chunk option '${key}'. Supported options: ${chunkOptionSummary}.`);
    }
    if (isSupportedOptionKey(key)) {
      options[key] = parseOptionValue(key, value);
    } else if (isSupportedFigureOptionKey(key) && !isSupportedTableOptionKey(key)) {
      if (!(value === "" && key in sourceOptions)) {
        applyFigureOption(figure, key, value);
      }
    } else {
      if (!(value === "" && key in sourceOptions)) {
        applyTableOrFigureOption(table, figure, key, value);
      }
    }
    sourceOptionKeys.add(key);
    if (!(key === "echo" && options.echo === "fenced")) {
      echoFencedOptionLines.push(`#| ${key}: ${formatEchoFencedOptionValue(key, options, table, figure)}`);
    }
  }
  for (const key of /* @__PURE__ */ new Set([
    ...optionKeys,
    ...tableOptionKeys,
    ...figureOptionKeys
  ])) {
    if (!isSupportedChunkOptionKey(key)) {
      continue;
    }
    if (!(key in sourceOptions) || sourceOptionKeys.has(key)) {
      continue;
    }
    if (key === "echo" && options.echo === "fenced") {
      continue;
    }
    echoFencedOptionLines.push(`#| ${key}: ${formatEchoFencedOptionValue(key, options, table, figure)}`);
  }
  validateChunkMetadata(table, figure);
  return {
    code: codeLines.join("\n"),
    options,
    table,
    figure,
    echoFencedOptionLines
  };
}
function isSupportedOptionKey(key) {
  return optionKeys.includes(key);
}
function isSupportedTableOptionKey(key) {
  return tableOptionKeys.includes(key);
}
function isSupportedFigureOptionKey(key) {
  return figureOptionKeys.includes(key);
}
function isDocumentFigureOptionKey(key) {
  return documentFigureOptionKeys.includes(key);
}
function isSupportedChunkOptionKey(key) {
  return isSupportedOptionKey(key) || isSupportedTableOptionKey(key) || isSupportedFigureOptionKey(key);
}
function applyTableOrFigureOption(table, figure, key, value) {
  if (key === "label") {
    const label = parseLabel(value);
    if (label.startsWith("tbl-")) {
      table.label = label;
    } else {
      figure.label = label;
    }
    return;
  }
  table.caption = parseStringChunkOption("tbl-cap", value);
}
function parseLabel(value) {
  const label = parseStringChunkOption("label", value);
  if (!label.startsWith("tbl-") && !label.startsWith("fig-")) {
    throw new Error("uv-python chunk option 'label' currently supports only tbl-* table labels or fig-* figure labels.");
  }
  if (!/^(tbl|fig)-[A-Za-z0-9_.:-]+$/.test(label)) {
    throw new Error("uv-python chunk option 'label' must be a simple tbl-* or fig-* identifier without spaces or braces.");
  }
  return label;
}
function applyFigureSetting(figure, key, value) {
  if (key === "fig-width") {
    figure.width = parsePositiveNumberChunkOption(key, value);
  } else if (key === "fig-height") {
    figure.height = parsePositiveNumberChunkOption(key, value);
  } else if (key === "fig-dpi") {
    figure.dpi = parsePositiveNumberChunkOption(key, value);
  } else {
    figure.format = parseFigureFormat(value);
  }
}
function applyFigureOption(figure, key, value) {
  if (isDocumentFigureOptionKey(key)) {
    applyFigureSetting(figure, key, value);
  } else if (key === "fig-cap") {
    figure.caption = parseStringOrStringListChunkOption(key, value);
  } else if (key === "fig-alt") {
    figure.alt = parseStringChunkOption(key, value);
  } else if (key === "fig-align") {
    figure.align = parseFigureAlign(value);
  } else if (key === "fig-link") {
    figure.link = parseStringChunkOption(key, value);
  } else if (key === "width") {
    figure.attrWidth = parseImageAttributeDimension(key, value);
  } else if (key === "height") {
    figure.attrHeight = parseImageAttributeDimension(key, value);
  }
}
function validateChunkMetadata(table, figure) {
  const hasTableMetadata = table.caption !== void 0 || table.label !== void 0;
  const hasFigureMetadata = figure.caption !== void 0 || figure.label !== void 0 || figure.alt !== void 0 || figure.align !== void 0 || figure.link !== void 0 || figure.attrWidth !== void 0 || figure.attrHeight !== void 0;
  if (hasTableMetadata && hasFigureMetadata) {
    throw new Error("uv-python does not support mixing table metadata and figure metadata in the same chunk.");
  }
  if (figure.label !== void 0 && figure.caption === void 0) {
    throw new Error("uv-python fig-* labels require fig-cap so Quarto can create a cross-referenceable figure.");
  }
}
function parseStringChunkOption(key, value) {
  if (typeof value !== "string") {
    throw new Error(`uv-python chunk option '${key}' supports only string values.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`uv-python chunk option '${key}' must not be empty.`);
  }
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first === '"' && last === '"' || first === "'" && last === "'") {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
function parseStringOrStringListChunkOption(key, value) {
  if (Array.isArray(value)) {
    const parsed = value.map((entry) => parseStringChunkOption(key, entry));
    if (parsed.length === 0) {
      throw new Error(`uv-python chunk option '${key}' list must not be empty.`);
    }
    return parsed;
  }
  return parseStringChunkOption(key, value);
}
function parsePositiveNumberChunkOption(key, value) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(parseStringChunkOption(key, value)) : NaN;
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`uv-python chunk option '${key}' supports only positive numeric values.`);
  }
  return numberValue;
}
function parseFigureFormat(value) {
  const normalized = parseStringChunkOption("fig-format", value).toLowerCase();
  if (normalized === "png" || normalized === "retina") {
    return "png";
  }
  if (normalized === "svg") {
    return "svg";
  }
  throw new Error("uv-python chunk option 'fig-format' currently supports only png, svg, or retina values.");
}
function parseFigureAlign(value) {
  const normalized = parseStringChunkOption("fig-align", value).toLowerCase();
  if (normalized === "default" || normalized === "left" || normalized === "right" || normalized === "center") {
    return normalized;
  }
  throw new Error("uv-python chunk option 'fig-align' supports only default, left, right, or center values.");
}
function parseImageAttributeDimension(key, value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`uv-python chunk option '${key}' supports only positive numeric or string dimensions.`);
    }
    return String(value);
  }
  return parseStringChunkOption(key, value);
}
function parseOptionValue(key, value) {
  if (key === "echo") {
    return parseEchoValue(value);
  }
  if (key === "output") {
    return parseOutputValue(value);
  }
  return parseBooleanValue(key, value);
}
function parseBooleanValue(key, value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  throw new Error(`uv-python option '${key}' supports only true or false values.`);
}
function parseEchoValue(value) {
  if (typeof value === "string" && value.trim().toLowerCase() === "fenced") {
    return "fenced";
  }
  try {
    return parseBooleanValue("echo", value);
  } catch (_error) {
    throw new Error("uv-python option 'echo' supports only true, false, or fenced values.");
  }
}
function parseOutputValue(value) {
  if (typeof value === "string" && value.trim().toLowerCase() === "asis") {
    return "asis";
  }
  try {
    return parseBooleanValue("output", value);
  } catch (_error) {
    throw new Error("uv-python option 'output' supports only true, false, or asis values.");
  }
}
function formatEchoFencedOptionValue(key, options, table, figure) {
  const value = isSupportedOptionKey(key) ? options[key] : key === "label" ? table.label ?? figure.label ?? "" : key === "tbl-cap" ? table.caption ?? "" : figureOptionValueForEcho(key, figure);
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }
  return typeof value === "boolean" || typeof value === "number" ? String(value) : value;
}
function figureOptionValueForEcho(key, figure) {
  if (key === "fig-width") {
    return figure.width ?? "";
  }
  if (key === "fig-height") {
    return figure.height ?? "";
  }
  if (key === "fig-dpi") {
    return figure.dpi ?? "";
  }
  if (key === "fig-format") {
    return figure.format;
  }
  if (key === "fig-cap") {
    return figure.caption ?? "";
  }
  if (key === "fig-alt") {
    return figure.alt ?? "";
  }
  if (key === "fig-align") {
    return figure.align ?? "";
  }
  if (key === "fig-link") {
    return figure.link ?? "";
  }
  if (key === "width") {
    return figure.attrWidth ?? "";
  }
  if (key === "height") {
    return figure.attrHeight ?? "";
  }
  return "";
}
function figureSettingsForRunner(figure) {
  return {
    format: figure.format,
    ...figure.width !== void 0 ? {
      width: figure.width
    } : {},
    ...figure.height !== void 0 ? {
      height: figure.height
    } : {},
    ...figure.dpi !== void 0 ? {
      dpi: figure.dpi
    } : {}
  };
}
function pythonParams(options) {
  const merged = {};
  mergeParams(merged, objectRecord(options.target.metadata)?.params, "document YAML params");
  mergeParams(merged, objectRecord(options.format.metadata)?.params, "format metadata params");
  mergeParams(merged, options.params, "ExecuteOptions params");
  return merged;
}
function uvPythonWithRequirements(options) {
  const formatMetadata = objectRecord(options.format.metadata);
  const uvPythonMetadata = objectRecord(formatMetadata?.[kEngineName]);
  if (uvPythonMetadata === void 0 || !("with" in uvPythonMetadata)) {
    return [];
  }
  return parseUvPythonWithRequirements(uvPythonMetadata.with);
}
function parseUvPythonWithRequirements(value) {
  if (!Array.isArray(value)) {
    throw new Error("uv-python metadata 'uv-python.with' must be a list of package requirement strings.");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`uv-python metadata 'uv-python.with' entry ${index + 1} must be a string package requirement.`);
    }
    const requirement = entry.trim();
    if (requirement.length === 0) {
      throw new Error(`uv-python metadata 'uv-python.with' entry ${index + 1} must not be empty.`);
    }
    if (requirement.startsWith("-")) {
      throw new Error(`uv-python metadata 'uv-python.with' entry ${index + 1} must be a package requirement, not a uv option: '${requirement}'.`);
    }
    return requirement;
  });
}
function mergeParams(merged, value, sourceName) {
  if (value === void 0) {
    return;
  }
  const params = objectRecord(value);
  if (params === void 0) {
    throw new Error(`uv-python ${sourceName} must be a YAML mapping.`);
  }
  Object.assign(merged, params);
}
function quartoExecuteInfo(options, documentPath) {
  return {
    "document-path": documentPath,
    format: {
      identifier: options.format.identifier ?? {},
      execute: options.format.execute ?? {},
      render: options.format.render ?? {},
      pandoc: options.format.pandoc ?? {},
      language: options.format.language ?? {},
      metadata: options.format.metadata ?? {}
    }
  };
}
async function runPythonRunner(input) {
  await Deno.mkdir(input.tempDir, {
    recursive: true
  });
  const requestPath = await Deno.makeTempFile({
    dir: input.tempDir,
    prefix: "uv-python-request-",
    suffix: ".json"
  });
  const responsePath = await Deno.makeTempFile({
    dir: input.tempDir,
    prefix: "uv-python-response-",
    suffix: ".json"
  });
  const executeInfoPath = await Deno.makeTempFile({
    dir: input.tempDir,
    prefix: "uv-python-execute-info-",
    suffix: ".json"
  });
  await Deno.writeTextFile(executeInfoPath, JSON.stringify(input.executeInfo, null, 2));
  const request = {
    chunks: input.chunks,
    items: input.items,
    documentPath: input.documentPath,
    documentCwd: input.documentCwd,
    projectRoot: input.projectRoot,
    figureDir: input.figureDir,
    params: input.params,
    responsePath
  };
  await Deno.writeTextFile(requestPath, JSON.stringify(request, null, 2));
  const runnerPath = join3(extensionDir, "runner.py");
  const uvArgs = [
    "run",
    ...input.optionalRequirements.flatMap((requirement) => [
      "--with",
      requirement
    ]),
    "python",
    runnerPath,
    requestPath,
    responsePath
  ];
  const command = new Deno.Command("uv", {
    args: uvArgs,
    cwd: input.projectRoot,
    env: {
      QUARTO_EXECUTE_INFO: executeInfoPath
    },
    stdout: "piped",
    stderr: "piped"
  });
  const result = await command.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  let response;
  try {
    response = JSON.parse(await Deno.readTextFile(responsePath));
  } catch (_error) {
    response = void 0;
  }
  if (response !== void 0) {
    validateRunnerResponse(response, input.chunks.length);
  }
  if (!result.success) {
    const failedUnit = response?.failedInline !== void 0 ? `inline expression ${response.failedInline + 1}` : response?.failedChunk !== void 0 ? `chunk ${response.failedChunk + 1}` : "runner";
    const details = [
      `uv-python failed while executing ${failedUnit}.`,
      `Command: ${formatArgv([
        "uv",
        ...uvArgs
      ])}`,
      stdout.trim() ? `uv stdout:
${stdout}` : "",
      stderr.trim() ? `uv stderr:
${stderr}` : ""
    ].filter(Boolean).join("\n\n");
    throw new Error(details);
  }
  if (response === void 0) {
    throw new Error("uv-python runner completed without writing response JSON.");
  }
  return response;
}
function formatArgv(argv) {
  return argv.map(formatArg).join(" ");
}
function formatArg(arg) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replaceAll("'", "'\\''")}'`;
}
function validateRunnerResponse(response, chunkCount) {
  if (response.protocol !== kOutputProtocolVersion) {
    throw new Error(`uv-python runner returned unsupported output protocol '${String(response.protocol)}'. Expected '${kOutputProtocolVersion}'.`);
  }
  if (!Array.isArray(response.events)) {
    throw new Error("uv-python runner response is missing an events array.");
  }
  let previousSequence = -1;
  for (const event of response.events) {
    if (event.protocol !== kOutputProtocolVersion) {
      throw new Error(`uv-python runner event ${String(event.sequence)} uses unsupported output protocol '${String(event.protocol)}'.`);
    }
    if (!Number.isInteger(event.sequence) || event.sequence <= previousSequence) {
      throw new Error("uv-python runner events are not in strictly increasing sequence order.");
    }
    previousSequence = event.sequence;
    if (!Number.isInteger(event.chunkIndex)) {
      throw new Error(`uv-python runner event ${event.sequence} has invalid chunkIndex '${String(event.chunkIndex)}'.`);
    }
    const hasInlineIndex = event.inlineIndex !== void 0;
    if (hasInlineIndex && (!Number.isInteger(event.inlineIndex) || event.inlineIndex < 0)) {
      throw new Error(`uv-python runner event ${event.sequence} has invalid inlineIndex '${String(event.inlineIndex)}'.`);
    }
    if (!hasInlineIndex && (event.chunkIndex < 0 || event.chunkIndex >= chunkCount)) {
      throw new Error(`uv-python runner event ${event.sequence} has out-of-range chunkIndex '${String(event.chunkIndex)}'.`);
    }
    if (hasInlineIndex && (event.chunkIndex < -1 || event.chunkIndex >= chunkCount)) {
      throw new Error(`uv-python runner inline event ${event.sequence} has out-of-range preceding chunkIndex '${String(event.chunkIndex)}'.`);
    }
    if (!isOutputEventKind(event.kind)) {
      throw new Error(`uv-python runner event ${event.sequence} has unsupported kind '${String(event.kind)}'.`);
    }
  }
}
function isOutputEventKind(kind) {
  return [
    "stdout",
    "stderr",
    "warning",
    "error",
    "display_text",
    "display_markdown",
    "display_html",
    "figure",
    "skipped"
  ].includes(kind);
}
function figureArtifactFormatNamespace(options) {
  const identifier = options.format.identifier;
  const raw = typeof identifier?.["target-format"] === "string" && identifier["target-format"].trim() !== "" ? identifier["target-format"] : typeof identifier?.["base-format"] === "string" && identifier["base-format"].trim() !== "" ? identifier["base-format"] : "unknown-format";
  const sanitized = raw.trim().replaceAll(/[^A-Za-z0-9_.-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  return sanitized || "unknown-format";
}
async function clearActiveFigureDir(figureDir, engineFigureRoot, expectedParentDir) {
  if (basename3(engineFigureRoot) !== kEngineName || dirname3(engineFigureRoot) !== expectedParentDir || dirname3(figureDir) !== engineFigureRoot) {
    throw new Error(`Refusing to clear unexpected uv-python figure directory: ${figureDir}`);
  }
  try {
    await Deno.remove(figureDir, {
      recursive: true
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
}
function renderChunkMarkdown(chunk, output, documentCwd) {
  const { options } = chunk;
  if (!options.include) {
    return "";
  }
  const rendered = [];
  if (options.echo === true) {
    rendered.push(fencedBlock(".python", chunk.code));
  } else if (options.echo === "fenced") {
    rendered.push(fencedBlock(".markdown .uv-python-echo-fenced", executableFenceMarkdown(chunk)));
  }
  if (!options.eval || !options.output || output === void 0) {
    return rendered.join("");
  }
  const captionedTableSequence = chunk.table.caption !== void 0 ? captionedMarkdownTableSequence(chunk, output) : void 0;
  const renderedFigureSequences = /* @__PURE__ */ new Set();
  const figureEvents = output.events.filter((event) => event.kind === "figure");
  if (figureEvents.length > 0) {
    validateFigureRendering(chunk.figure, figureEvents.length);
  } else if (hasFigureRenderingMetadata(chunk.figure)) {
    throw new Error("uv-python figure metadata requires at least one matplotlib figure output in the chunk.");
  }
  for (const event of output.events) {
    switch (event.kind) {
      case "stdout":
        if (options.output === "asis") {
          rendered.push(rawMarkdownBlock(stringPayloadField(event, "text")));
        } else {
          rendered.push(fencedBlock(".text .uv-python-stdout", stringPayloadField(event, "text")));
        }
        break;
      case "stderr":
        rendered.push(fencedBlock(".text .uv-python-stderr", stringPayloadField(event, "text")));
        break;
      case "warning":
        if (options.warning) {
          rendered.push(fencedBlock(".text .uv-python-warning", warningText(event)));
        }
        break;
      case "error":
        if (options.error) {
          rendered.push(fencedBlock(".text .uv-python-error", stringPayloadField(event, "traceback")));
        }
        break;
      case "figure": {
        rendered.push(renderFigureMarkdown(chunk.figure, event, documentCwd, renderedFigureSequences.size));
        renderedFigureSequences.add(event.sequence);
        break;
      }
      case "skipped":
        break;
      case "display_text":
        rendered.push(fencedBlock(".text .uv-python-display-text", stringPayloadField(event, "text")));
        break;
      case "display_markdown":
        rendered.push(rawMarkdownBlock(event.sequence === captionedTableSequence ? appendTableCaption(stringPayloadField(event, "markdown"), chunk.table.caption ?? "", chunk.table.label) : stringPayloadField(event, "markdown")));
        break;
      case "display_html":
        rendered.push(rawMarkdownBlock(stringPayloadField(event, "html")));
        break;
      default:
        throw new Error(`Unsupported uv-python event kind '${event.kind}'.`);
    }
  }
  return rendered.join("");
}
function renderMarkdownCellWithInline(cell, eventsByInline, inlineOptions) {
  return cell.segments.map((segment) => {
    if (segment.kind === "text") {
      return segment.markdown;
    }
    const options = inlineOptions.get(segment.inlineIndex);
    if (options === void 0) {
      throw new Error(`uv-python internal error: missing inline options ${segment.inlineIndex}.`);
    }
    if (!options.include || !options.eval || !options.output) {
      return "";
    }
    const events = eventsByInline.get(segment.inlineIndex) ?? [];
    return events.map((event) => renderInlineEvent(event)).join("");
  }).join("");
}
function renderInlineEvent(event) {
  switch (event.kind) {
    case "stdout":
      return escapeInlineMarkdownText(stringPayloadField(event, "text"));
    case "stderr":
      return escapeInlineMarkdownText(stringPayloadField(event, "text"));
    case "warning":
      return escapeInlineMarkdownText(warningText(event));
    case "display_text":
      return escapeInlineMarkdownText(stringPayloadField(event, "text"));
    case "display_markdown":
      return stringPayloadField(event, "markdown");
    case "display_html":
      return stringPayloadField(event, "html");
    case "skipped":
      return "";
    case "error":
      return escapeInlineMarkdownText(stringPayloadField(event, "traceback"));
    case "figure":
      throw new Error("uv-python inline expressions do not support figure output.");
    default:
      throw new Error(`Unsupported uv-python inline event kind '${event.kind}'.`);
  }
}
function validateFigureRendering(figure, figureCount) {
  if (figure.label !== void 0 && figureCount !== 1) {
    throw new Error("uv-python fig-* labels currently support exactly one figure per chunk; use separate chunks or omit the label for basic multi-figure output.");
  }
  if (figure.label !== void 0 && figure.caption === void 0) {
    throw new Error("uv-python fig-* labels require fig-cap so Quarto can create a cross-referenceable figure.");
  }
  if (Array.isArray(figure.caption) && figure.caption.length !== figureCount) {
    throw new Error(`uv-python fig-cap list length (${figure.caption.length}) must match the number of figures in the chunk (${figureCount}).`);
  }
}
function hasFigureRenderingMetadata(figure) {
  return figure.caption !== void 0 || figure.label !== void 0 || figure.alt !== void 0 || figure.align !== void 0 || figure.link !== void 0 || figure.attrWidth !== void 0 || figure.attrHeight !== void 0;
}
function renderFigureMarkdown(figure, event, documentCwd, figureOrdinal) {
  const relPath = relative3(documentCwd, stringPayloadField(event, "path")).replaceAll("\\", "/");
  const caption = figureCaptionForOrdinal(figure.caption, figureOrdinal);
  const attributes = figureMarkdownAttributes(figure);
  const imageLabel = caption !== void 0 ? escapeMarkdownImageText(caption) : "";
  const image = `![${imageLabel}](${relPath})${attributes}`;
  const linked = figure.link !== void 0 ? `[${image}](${figure.link})` : image;
  return `${linked}

`;
}
function figureCaptionForOrdinal(caption, figureOrdinal) {
  if (Array.isArray(caption)) {
    return caption[figureOrdinal];
  }
  return caption;
}
function figureMarkdownAttributes(figure) {
  const attrs = [];
  if (figure.label !== void 0) {
    attrs.push(`#${figure.label}`);
  }
  attrs.push(`fig-alt=${markdownAttributeValue(figure.alt ?? "Python figure")}`);
  if (figure.align !== void 0 && figure.align !== "default") {
    attrs.push(`fig-align=${markdownAttributeValue(figure.align)}`);
  }
  if (figure.attrWidth !== void 0) {
    attrs.push(`width=${markdownAttributeValue(figure.attrWidth)}`);
  }
  if (figure.attrHeight !== void 0) {
    attrs.push(`height=${markdownAttributeValue(figure.attrHeight)}`);
  }
  return attrs.length > 0 ? `{${attrs.join(" ")}}` : "";
}
function markdownAttributeValue(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
function escapeMarkdownImageText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]").replaceAll("\n", " ");
}
function captionedMarkdownTableSequence(chunk, output) {
  const tableEvents = output.events.filter((event) => event.kind === "display_markdown").map((event) => ({
    event,
    markdown: stringPayloadField(event, "markdown"),
    blocks: markdownPipeTableBlocks(stringPayloadField(event, "markdown"))
  })).filter((entry) => entry.blocks.length > 0);
  const tableCount = tableEvents.reduce((total, entry) => total + entry.blocks.length, 0);
  if (tableCount !== 1) {
    throw new Error(`uv-python tbl-cap requires exactly one Markdown pipe table display event in the chunk; found ${tableCount}. Use one display(Markdown(...)) table per caption.`);
  }
  const tableEvent = tableEvents[0];
  if (!markdownTablePayloadIsOnlyTable(tableEvent.markdown, tableEvent.blocks[0])) {
    throw new Error("uv-python tbl-cap requires the captioned Markdown display payload to contain exactly one pipe table and no leading or trailing Markdown/prose outside that table. Use a separate chunk/event or remove extra content.");
  }
  return tableEvent.event.sequence;
}
function appendTableCaption(markdown, caption, label) {
  const table = markdown.trimEnd();
  const attr = label !== void 0 ? ` {#${label}}` : "";
  return `${table}

: ${caption}${attr}

`;
}
function markdownPipeTableBlocks(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerCells = pipeCells(lines[index]);
    const separatorCells = pipeCells(lines[index + 1]);
    if (headerCells.length === 0 || separatorCells.length === 0) {
      continue;
    }
    if (headerCells.length !== separatorCells.length) {
      continue;
    }
    if (!separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) {
      continue;
    }
    const block = {
      startLine: index,
      endLine: index + 1
    };
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      if (lines[rowIndex].trim() === "") {
        break;
      }
      const rowCells = pipeCells(lines[rowIndex]);
      if (rowCells.length !== headerCells.length) {
        break;
      }
      block.endLine = rowIndex;
    }
    blocks.push(block);
    index = block.endLine;
  }
  return blocks;
}
function markdownTablePayloadIsOnlyTable(markdown, block) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  return lines.every((line, index) => {
    if (index >= block.startLine && index <= block.endLine) {
      return true;
    }
    return line.trim() === "";
  });
}
function pipeCells(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return [];
  }
  const withoutLeading = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutOuter = withoutLeading.endsWith("|") ? withoutLeading.slice(0, -1) : withoutLeading;
  return withoutOuter.split("|").map((cell) => cell.trim());
}
function executableFenceMarkdown(chunk) {
  const bodyLines = [
    ...chunk.echoFencedOptionLines,
    ...chunk.code.split(/\r?\n/)
  ];
  const body = bodyLines.join("\n");
  const fence = "`".repeat(longestFenceLength(body));
  const normalizedBody = body.endsWith("\n") ? body : `${body}
`;
  return `${fence}{python}
${normalizedBody}${fence}
`;
}
function rawMarkdownBlock(markdown) {
  return markdown.endsWith("\n") ? markdown : `${markdown}
`;
}
function warningText(event) {
  const formatted = event.metadata?.formatted;
  if (typeof formatted === "string" && formatted.length > 0) {
    return formatted;
  }
  const message = stringPayloadField(event, "message");
  const category = stringPayloadField(event, "category", false);
  const filename = stringPayloadField(event, "filename", false);
  const lineno = numericPayloadField(event, "lineno", false);
  const location = filename ? `${filename}${lineno !== void 0 ? `:${lineno}` : ""}: ` : "";
  return `${location}${category ? `${category}: ` : ""}${message}
`;
}
function stringPayloadField(event, field, required = true) {
  const value = event.payload[field];
  if (typeof value === "string") {
    return value;
  }
  if (!required && value === void 0) {
    return "";
  }
  throw new Error(`uv-python event ${event.sequence} (${event.kind}) is missing string payload field '${field}'.`);
}
function numericPayloadField(event, field, required = true) {
  const value = event.payload[field];
  if (typeof value === "number") {
    return value;
  }
  if (!required && value === void 0) {
    return void 0;
  }
  throw new Error(`uv-python event ${event.sequence} (${event.kind}) is missing numeric payload field '${field}'.`);
}
function numericMetadataField(event, field) {
  const value = event.metadata?.[field];
  return typeof value === "number" ? value : void 0;
}
function fencedBlock(classes, content) {
  const fence = "`".repeat(longestFenceLength(content));
  const normalizedContent = content.endsWith("\n") ? content : `${content}
`;
  return `${fence} {${classes}}
${normalizedContent}${fence}

`;
}
function escapeInlineMarkdownText(content) {
  return content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(/([\\`*_{}\[\]()#+\-.!|$~^])/g, "\\$1").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", " ");
}
function longestFenceLength(content) {
  return Math.max(3, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length + 1));
}
export {
  uv_python_default as default
};
