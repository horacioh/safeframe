(function () {/**
 * @license almond 0.2.9 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            return req.apply(undef, aps.call(arguments, 0).concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../../bower_components/almond/almond.js", function(){});

// Generated by CoffeeScript 1.7.1
(function() {
  define('shared/lang',[], function() {
    var ParamHash, backSlash, callable, cbool, cnum, cstr, def, entityMap, entityRegexes, guid, isArray, jssafe_html, lang, mix, next_id, noop, ns, proto, rand, scrip_str, time, toString, trim, win, _es, _keys, _ue;
    next_id = 0;
    win = typeof window !== "undefined" && window !== null ? window : this;
    backSlash = String.fromCharCode(92);
    scrip_str = 'scr"+"ipt';
    _es = win.escape;
    _ue = win.unescape;

    /*
    A function reference that does nothing.
    
    @memberOf $sf.lib.lang
    @exports noop as $sf.lib.lang.noop
    @static
    @function
    @public
    @return undefined
     */
    noop = function() {

      /*
      Forces type conversion of any JavaScript variable to a string value.
      Note that "falsy" values or values that cannot be converted will be returned
      as an empty string ("").
      
      @memberOf $sf.lib.lang
      @exports cstr as $sf.lib.lang.cstr
      @static
      @public
      @function
      @param {*} str  Any object that needs to be converted to a string value.
      @return {String}  The normalized string value.
       */
    };
    cstr = function(str) {
      var typ;
      typ = typeof str;
      if (typ === "string") {
        return str;
      }
      if (typ === "number" && !str) {
        return "0";
      }
      if (typ === "object" && str && str.join) {
        return str.join("");
      }
      if (typ === "boolean") {
        return str.toString();
      }
      if (str) {
        return String(str);
      } else {
        return "";
      }
    };

    /*
    Forces type conversion of any JavaScript variable to a boolean.
    "Falsy" values such as "", 0, null, and undefined all return false
    String values of  "0", "false", "no", "undefined", "null" also return false
    
    @memberOf $sf.lib.lang
    @exports cbool as $sf.lib.lang.cbool
    @static
    @public
    @function
    @param {*} val Any JavaScript reference / value
    @return {Boolean} The normalized boolean value
     */
    cbool = function(val) {
      return !([void 0, "0", "false", "no", "undefined", "null", null].indexOf(val) >= 0 || false);
    };
    _keys = function(obj) {
      var k, _v;
      return (typeof Object.keys === "function" ? Object.keys(obj) : void 0) || ((function() {
        var _results;
        _results = [];
        for (k in obj) {
          _v = obj[k];
          _results.push(k);
        }
        return _results;
      })());
    };

    /*
    Forces type conversion of any JavaScript variable to a number.
    Values / objects that cannot be converted, will be returned as NaN, unless
    a default value is specified, in which case the default value is used.
    
    @memberOf $sf.lib.lang
    @exports cnum as $sf.lib.lang.cnum
    @static
    @public
    @function
    @param {*} val Any JavaScript reference / value
    @param {*} [defVal] use this value if original value cannot be converted to a number, or if value is less than min value, or if value is less than max value.
    @param {Number} [minVal] specifies the lowest numerical value, if original value is less than this value, the defVal will be returned.
    @param {Number} [maxVal] specifies the greatest numerical value, if original value is greater than this value, the defVal will be returned.
    @return {Number|NaN|*} the converted value, otherwise NaN or default value
     */
    cnum = function(val, defVal, minVal, maxVal) {
      var e;
      if (typeof val !== "number") {
        try {
          if (!val) {
            val = Number.NaN;
          } else {
            val = parseFloat(val);
          }
        } catch (_error) {
          e = _error;
          val = Number.NaN;
        }
      }
      if (maxVal == null) {
        maxVal = Number.MAX_VALUE;
      }
      if (minVal == null) {
        minVal = -Number.MAX_VALUE;
      }
      if ((isNaN(val) || val < minVal || val > maxVal) && (defVal != null)) {
        return defVal;
      } else {
        return val;
      }
    };

    /*
    Checks that a function reference can be called safely.  Sometimes function references are part
    of objects that may have been garbage collected (such as a function reference from another window or dom element).
    This method checks the reference by making sure it has a constructor and toString properties.
    
    Note that this doesn't mean that the function itself when called (or its subsquent call stack), can't throw an error. . .
    simply that you are able to call it. . .
    
    this can problem be removed in lieu of func?() in cs
    
    @memberOf $sf.lib.lang
    @exports callable as $sf.lib.lang.callable
    @static
    @public
    @function
    @param {Function} A reference to a JavaScript function
    @return {Boolean} true if function can be called safely, otherwise false.
     */
    callable = function(f) {
      var e;
      try {
        f = (f && typeof f === "function" && f.toString() && (new f.constructor()) ? f : null);
      } catch (_error) {
        e = _error;
        f = null;
      }
      return !!f;
    };

    /*
    Generate a unique id string
    
    @memberOf $sf.lib.lang
    @exports guid as $sf.lib.lang.guid
    @static
    @public
    @function
    @param {String} [prefix] a substring to use a prefix
    @return {String} unique id string
     */
    guid = function(prefix) {
      return cstr([prefix || "", "_", time(), "_", rand(), "_", next_id++]);
    };

    /*
    Mixed the properties of one object into another object.
    Note that this function is recursive
    
    
    
    @memberOf $sf.lib.lang
    @exports mix as $sf.lib.lang.mix
    @static
    @public
    @function
    @param {Object}  r  The object that will receive properties
    @param {Object}  s  The object that will deliever properties
    @param {Boolean} [owned] Whether or not to skip over properties that are part of the object prototype
    @param {Boolean} [skipFuncs] Whether or not to skip over function references
    @param {Boolean} [no_ovr] Whether or not to overwrite properties that may have already been filled out
    @return {Object} The receiver object passed in with potentially new properties added
     */
    mix = function(r, s, owned, skipFuncs, no_ovr) {
      var item, p, typ;
      if (!s || !r) {
        return r;
      }
      for (p in s) {
        item = s[p];
        typ = typeof item;
        if (owned && !s.hasOwnProperty(p)) {
          continue;
        }
        if (no_ovr && (p in r)) {
          continue;
        }
        if (skipFuncs && typ === "function") {
          continue;
        }
        if (typ === "object" && item) {
          if (item.slice) {
            item = mix([], item);
          } else {
            item = mix({}, item);
          }
        }
        r[p] = item;
      }
      return r;
    };

    /*
    Return the current time in milliseconds, from the epoch
    
    @memberOf $sf.lib.lang
    @exports time as $sf.lib.lang.time
    @public
    @function
    @static
    @return {Number} current time
     */
    time = function() {
      return (new Date()).getTime();
    };

    /*
    Return a random integer anywhere from 0 to 99
    
    @memberOf $sf.lib.lang
    @exports rand as $sf.lib.lang.rand
    @public
    @static
    @function
    @return {Number} random number
     */
    rand = function() {
      return Math.round(Math.random() * 100);
    };

    /*
    Trim the begining and ending whitespace from a string.
    Note that this function will convert an argument to a string first
    for type safety purposes. If string cannot be converted, and empty string is returned
    
    @memberOf $sf.lib.lang
    @exports trim as $sf.lib.lang.trim
    @return {String} trimmed string
    @public
    @function
    @static
     */
    trim = function(str) {
      var ret;
      ret = cstr(str);
      return ret && ret.replace(/^\s\s*/, "").replace(/\s\s*$/, "");
    };

    /*
    Define a JavaScript Namespace within a given context
    
    @memberOf $sf.lib.lang
    @exports def as $sf.lib.lang.def
    @param {String} str_ns  The name of the namespace in dot notation as a string (e.g. "Foo.bar")
    @param {Object} [aug] defines the object at the end of the namespace.  If namespace is already specified, and this object is provided, the namespace will be augmented with properties from this object. If nothing is passed in, defaults to using an empty object.
    @param {Object} [root] the root object from which the namespace is defined.  If not passed in defaults to the global/window object
    @param {Boolean} [no_ovr] if true, properties already defined on root with the same name will be ignored
    @public
    @function
    @static
    @return {Object} The object at the end of the namespace
     */
    def = function(str_ns, aug, root, no_ovr) {
      var ar, idx, item, obj, per, ret;
      obj = (root && typeof root === "object" ? root : win);
      idx = 0;
      per = ".";
      ret = null;
      if (str_ns) {
        str_ns = cstr(str_ns);
        aug = (aug && typeof aug === "object" ? aug : null);
        if (str_ns.indexOf(per)) {
          ar = str_ns.split(per);
          while (item = ar[idx++]) {
            item = trim(item);
            if (idx === ar.length) {
              if (obj[item] && aug) {
                ret = obj[item] = mix(obj[item], aug, false, null, no_ovr);
              } else {
                if (no_ovr && (item in obj)) {
                  ret = obj[item];
                } else {
                  ret = obj[item] = obj[item] || aug || {};
                }
              }
            } else {
              if (no_ovr && (item in obj)) {
                ret = obj[item];
              } else {
                ret = obj[item] = obj[item] || {};
              }
            }
            obj = obj[item];
          }
        } else {
          if (obj[str_ns] && aug) {
            ret = obj[str_ns] = mix(obj[str_ns], aug, false, null, no_ovr);
          } else {
            ret = obj[str_ns] = obj[str_ns] || aug || {};
          }
        }
      }
      return ret;
    };

    /*
    Checks for the existence of a JavaScript namespace
    as opposed to def, which will automatically define the namespace
    with a given context.
    
    @memberOf $sf.lib.lang
    @exports ns as $sf.lib.lang.ns
    @param {String} str_ns  A string with . or [] notation of a JavaScript namesace (e.g. "foo.bar.show", or "foo['bar']['show']").
    @param {Object} [root] the root object to check within. .defaults to global / window
    @return {*} The endpoint reference of the namespace or false if not found
    @public
    @function
    @static
     */
    ns = function(str_ns, root) {
      var exists, exp, exp2, exp3, exp4, idx, matches, obj, prop, rootStr;
      exp = /(\[(.{1,})\])|(\.\w+)/g;
      exp2 = /\[(('|")?)((\s|.)*?)(('|")?)\]/g;
      exp3 = /(\[.*)|(\..*)/g;
      exp4 = /\./g;
      idx = 0;
      rootStr = "";
      exists = true;
      obj = root = root || win;
      if (str_ns) {
        str_ns = cstr(str_ns);
        if (str_ns) {
          str_ns = trim(str_ns);
          matches = str_ns.match(exp);
          if (matches) {
            rootStr = str_ns.replace(exp3, "");
            matches.unshift(rootStr);
            while (prop = matches[idx++]) {
              prop = prop.replace(exp2, "$3").replace(exp4, "");
              if (!obj[prop]) {
                exists = false;
                break;
              }
              obj = obj[prop];
            }
          } else {
            prop = str_ns;
            obj = obj[prop];
          }
        } else {
          exists = false;
        }
      } else {
        exists = false;
      }
      return (exists && obj) || false;
    };

    /*
    @function
    Tests to see if the object passed in is an array
     */
    isArray = function(obj) {
      if (obj == null) {
        return false;
      }
      if (typeof obj === "string") {
        return false;
      }
      if ((obj.length != null) && obj.constructor === Array) {
        return true;
      }
      return false;
    };

    /*
    Given a string of HTML escape quote marks and seperate script tags so that browsers don't get tripped up
    during processing.
    
    @memberOf $sf.lib.lang
    @exports jssafe_html as $sf.lib.lang.jssafe_html
    @param {String} str A string of HTML markup to be processed
    @return {String}
    @function
    @static
    @public
     */
    entityMap = {
      escape: {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;'
      }
    };
    entityRegexes = {
      escape: new RegExp('[' + _keys(entityMap.escape).join('') + ']', 'g')
    };
    jssafe_html = function(str) {
      if (str == null) {
        return '';
      }
      return ('' + string).replace(entityRegexes.escape, function(match) {
        return entityMap.escape[match];
      });
    };

    /*
    @class Intantiable class used to convert a delimited string into an object.<br />
    For example querystrings: "name_1=value_1&name_2=value_2" ==> {name_1:value_1,name_2:value_2};<br/><br />
    
    Note that property values could also contain the same sPropDelim and sValueDelim strings.  Proper string encoding should occur
    to not trip up the parsing of the string.  Said values may be ascii escaped, and in turn, along with the <i><b>bRecurse</b></i> constructor parameter set to true, will cause nested ParamHash objects to be created.
    
    @constructor
    @memberOf $sf.lib.lang
    @exports ParamHash as $sf.lib.lang.ParamHash
    @param {String} [sString]  The delimited string to be converted
    @param {String} [sPropDelim="&"]  The substring delimiter used to seperate properties. Default is "&".
    @param {String} [sValueDelim="="]  The substring delimited used to seperate values.  Default is "=".
    @param {Boolean} [bNoOverwrite=false]  If true, when a name is encountered more than 1 time in the string it will be ignored.
    @param {Boolean} [bRecurse=false]  If true, when a value of a property that is parsed also has both the sPropDelim and sValueDelim inside, convert that value to another ParamHash object automatically
    @example
    var ph = new $sf.lib.lang.ParamHash("x=1&y=1&z=1");
    alert(ph.x); // == 1
    alert(ph.y); // == 1
    alert(ph.z); // == 1
    
    @example
    var ph = new $sf.lib.lang.ParamHash("x:1;y:2;z:3", ";", ":");
    alert(ph.x); // == 1
    alert(ph.y); // == 2
    alert(ph.z); // == 3
    
    @example
    var ph = new $sf.lib.lang.ParamHash("x=1&y=1&z=1&z=2");
    alert(ph.x); // == 1
    alert(ph.y); // 1
    alert(ph.z); //Note that z == 2 b/c of 2 properties with the same name
    
    @example
    var ph = new $sf.lib.lang.ParamHash("x=1&y=1&z=1&z=2",null,null,true); //null for sPropDelim and sValueDelim == use default values of "&" and "=" respectively
    alert(ph.x); // == 1
    alert(ph.y); // 1
    alert(ph.z); //Note that z == 1 b/c bNoOverwrite was set to true
    
    @example
    //You can also do recursive processing if need be
    var points	= new $sf.lib.lang.ParamHash(),
    point_1	= new $sf.lib.lang.ParamHash(),
    point_2	= new $sf.lib.lang.ParamHash();
    
    point_1.x = 100;
    point_1.y = 75;
    
    point_2.x = 200;
    point_2.y = 150;
    
    points.point_1	= point_1;
    points.point_2	= point_2;
    
    var point_str	= points.toString();  // == "point_1=x%3D100%26y%3D75%26&point_2=x%3D200%26y%3D150%26&";
    var points_copy	= new $sf.lib.lang.ParamHash(point_str, null, null, true, true); //note passing true, b/c we want to recurse
    
    alert(points_copy.point_1.x) // == "100";
     */
    ParamHash = function(sString, sPropDelim, sValueDelim, bNoOverwrite, bRecurse) {
      var added, cnt, doAdd, idx, idx2, idx3, io, len, len2, me, nm, nv, obj, pairs, sTemp, sTemp2, sTemp3, ss;
      me = this;
      io = "indexOf";
      ss = "substring";
      doAdd = false;
      if (!(me instanceof ParamHash)) {
        return new ParamHash(sString, sPropDelim, sValueDelim, bNoOverwrite, bRecurse);
      }
      if (!arguments.length) {
        return me;
      }
      if (sString && typeof sString === "object") {
        return mix(new ParamHash("", sPropDelim, sValueDelim, bNoOverwrite, bRecurse), sString);
      }
      sString = cstr(sString);
      sPropDelim = cstr(sPropDelim) || "&";
      sValueDelim = cstr(sValueDelim) || "=";
      if (!sString) {
        return me;
      }
      if (sPropDelim !== "?" && sValueDelim !== "?" && sString.charAt(0) === "?") {
        sString = sString[ss](1);
      }
      idx = sString[io]("?");
      idx2 = sString[io](sValueDelim);
      if (idx !== -1 && idx2 !== -1 && idx > idx2) {
        sTemp = _es(sString[ss](idx2 + 1));
        sTemp2 = sString.substr(0, idx2 + 1);
        sString = sTemp2 + sTemp;
      } else if (idx !== -1) {
        sString = sString[ss](idx + 1);
        return new ParamHash(sString, sPropDelim, sValueDelim, bNoOverwrite);
      }
      if (sString.charAt(0) === sPropDelim) {
        sString = sString[ss](1);
      }
      pairs = sString.split(sPropDelim);
      cnt = pairs.length;
      idx = 0;
      while (cnt--) {
        sTemp = pairs[idx++];
        added = false;
        doAdd = false;
        if (sTemp) {
          nv = sTemp.split(sValueDelim);
          len = nv.length;
          if (len > 2) {
            nm = _ue(nv[0]);
            nv.shift();
            if (bRecurse) {
              sTemp2 = nm + sValueDelim;
              idx2 = sString[io](sTemp2);
              len = sTemp2[LEN];
              sTemp3 = sString[ss](idx2 + len);
              sTemp2 = sPropDelim + sPropDelim;
              len2 = sTemp2[LEN];
              idx3 = sTemp3[io](sTemp2);
              if (idx3 !== -1) {
                sTemp3 = sString.substr(idx2 + len, idx3 + len2);
                obj = new ParamHash(sTemp3, sPropDelim, sValueDelim, bNoOverwrite, bRecurse);
                sTemp3 = "";
                len = 0;
                for (sTemp3 in obj) {
                  continue;
                }
                if (len > 0) {
                  idx += len - 1;
                }
                sTemp = obj;
              } else {
                sTemp = _ue(nv.join(sValueDelim));
              }
            } else {
              sTemp = _ue(nv.join(sValueDelim));
            }
            doAdd = true;
          } else if (len === 2) {
            nm = _ue(nv[0]);
            sTemp = _ue(nv[1]);
            doAdd = true;
          }
          if (doAdd) {
            if (bNoOverwrite) {
              if (!(nm in me)) {
                me[nm] = sTemp;
                added = true;
              }
            } else {
              me[nm] = sTemp;
              added = true;
            }
            if (bRecurse && added && nm && sTemp && typeof sTemp !== "object" && (sTemp[io](sPropDelim) >= 0 || sTemp[io](sValueDelim) >= 0)) {
              me[nm] = new ParamHash(sTemp, sPropDelim, sValueDelim, bNoOverwrite, bRecurse);
            }
          }
        }
      }
    };

    /*
    Converts a ParamHash object back into a string using the property and value delimiters specifed (defaults to "&" and "=").
    Again this method works recursively.  If an object is found as a property, it will convert that object into a ParamHash string
    and then escape it. Note also that this class's valueOf method is equal to this method.
    
    @methodOf ParamHash#
    @public
    @function
    @param {String} [sPropDelim="&"]  The substring delimiter used to seperate properties. Default is "&".
    @param {String} [sValueDelim="="]  The substring delimited used to seperate values.  Default is "=".
    @param {Boolean} [escapeProp=false] Whether or not to ascii escape the name of a property
    @param {Boolean} [dontEscapeValue=false] Do not escape values or properties automatically
    @return {String} the encoded string representation of the object.
     */
    toString = function(sPropDelim, sValueDelim, escapeProp, dontEscapeValue) {
      var buffer, item, itemType, me, prop;
      prop = void 0;
      buffer = [];
      me = this;
      itemType = void 0;
      item = void 0;
      sPropDelim = sPropDelim || "&";
      sValueDelim = sValueDelim || "=";
      for (prop in me) {
        item = me[prop];
        itemType = typeof item;
        if (item && itemType === "function") {
          continue;
        }
        if (item && itemType === "object") {
          item = toString.apply(item, [sPropDelim, sValueDelim, escapeProp, dontEscapeValue]);
        }
        if (escapeProp) {
          prop = _es(prop);
        }
        if (!dontEscapeValue) {
          item = _es(item);
        }
        buffer.push(prop, sValueDelim, item, sPropDelim);
      }
      return cstr(buffer);
    };
    proto = ParamHash.prototype;
    if (!String.prototype.trim) {
      String.prototype.trim = trim;
    }

    /*
    @ignore
     */
    proto.toString = proto.valueOf = toString;
    lang = {
      ParamHash: ParamHash,
      cstr: cstr,
      cnum: cnum,
      cbool: cbool,
      noop: noop,
      trim: trim,
      callable: callable,
      guid: guid,
      mix: mix,
      time: time,
      rand: rand,
      def: def,
      ns: ns,
      jssafe_html: jssafe_html,
      isArray: isArray
    };
    if (typeof exports !== "undefined" && exports !== null) {
      return exports.lang = lang;
    } else {
      return lang;
    }
  });

}).call(this);

// Generated by CoffeeScript 1.7.1
(function() {
  var __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  define('shared/env',[], function() {
    var cached_ua, isIE, isIE11, navigator, theDocument, ua, userAgent, win;
    win = window;
    navigator = window.navigator;
    theDocument = window.document;
    userAgent = (navigator != null ? navigator.userAgent : void 0) || "";
    isIE11 = !window.ActiveXObject && __indexOf.call(window, "ActiveXObject") >= 0;
    isIE = !isIE11 && (win && (__indexOf.call(win, "ActiveXObject") >= 0));
    cached_ua = null;
    ua = (function() {

      /*
      Convert a version string into a numeric value
      
      @name $sf.env.ua-_numberify
      @static
      @private
      @function
      @param {String} s The string representing a version number (e.g. 'major.minor.revision')
      @returns {Number}
       */
      var parse_ua, _matchIt, _numberify, _testIt;
      _numberify = function(s) {
        var c;
        c = 0;
        return parseFloat(s.replace(/\./g, function() {
          if (c++ === 1) {
            return "";
          } else {
            return ".";
          }
        }));
      };

      /*
      Wrapper method for returning values from a regular expression match safely.
      
      @name $sf.env.ua-_matchIt
      @static
      @private
      @function
      @param {String} str The string to match against
      @param {RegExp} regEx The regular expression to use for matching
      @param {Number} [idx] The index number of a match to pull from
      @returns {String}
       */
      _matchIt = function(str, regEx, idx) {
        var m;
        m = str && str.match(regEx);
        if (!(idx != null)) {
          return m;
        } else {
          return (m && m[idx]) || null;
        }
      };

      /*
      Wrapper method for testing a string against a regular expression
      
      @name $sf.env.ua-_testIt
      @static
      @private
      @function
      @param {RegExp} regEx The regular expression to test with
      @param {String} str The string to test against
      @param {Boolean}
       */
      _testIt = function(regEx, str) {
        return regEx.test(str);
      };

      /*
      Parse a user-agent string from the browser and gather pertinent browser, and OS information
      
      @name $sf.env.ua.parse
      @static
      @public
      @function
      @param {String} [subUA] An alternate user-agent string to parse. If no valid string is passed in, function will return an object based on the known user-agent
      @returns {Object} <b>parsed</b> Browser and OS information<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.ie  The major version number of the Internet Explorer browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.opera The major version number of the Opera browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.gecko The major version number of the Gecko (Firefox) browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.webkit The major version number of the WebKit browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.safari The major version number of the Safari browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.chrome The major version number of the Chrome browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.air The major version number of the AIR SDK being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.ipod Whether or not an iPod device is being used 1 for true, 0 for false.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.ipad Whether or not an iPad device is being used 1 for true, 0 for false.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.iphone Whether or not an iPhone device is being used 1 for true, 0 for false.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.android The major version number of the Android OS being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.webos The major version number of the WebOS being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.silk The major version number of the Silk browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.nodejs The major version number of the NodeJS environment being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.phantomjs The major version number of the PhantomJS environment being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {String} <b>parsed</b>.mobile A string representing whether or not the browser / os is a mobile device  and it's type. Possible values are 'windows', 'android', 'symbos', 'linux', 'macintosh', 'rhino', 'gecko', 'Apple', 'chrome'.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.ios The major version number of the iOS being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Boolean} <b>parsed</b>.accel Whether or not the browser / environment in question is hardware accelerated.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @returns {Number} <b>parsed</b>.cajaVersion The major version number of the CAJA environment or 0 if not.
       */
      parse_ua = function(subUA) {
        var date, e, match, ret;
        ret = {};
        date = new Date();
        if (!subUA && cached_ua) {
          return cached_ua;
        }
        ret.ie = ret.opera = ret.gecko = ret.webkit = ret.safari = ret.chrome = ret.air = ret.ipod = ret.ipad = ret.iphone = ret.android = ret.webos = ret.silk = ret.nodejs = ret.phantomjs = 0;
        ret.mobile = ret.ios = ret.os = null;
        ret.accel = false;
        ret.caja = navigator && navigator.cajaVersion;
        ret.cks = false;
        subUA = subUA || userAgent || "";
        if (subUA) {
          if (_testIt(/windows|win32/i, subUA)) {
            ret.os = "windows";
          } else if (_testIt(/macintosh|mac_powerpc/i, subUA)) {
            ret.os = "macintosh";
          } else if (_testIt(/android/i, subUA)) {
            ret.os = "android";
          } else if (_testIt(/symbos/i, subUA)) {
            ret.os = "symbos";
          } else if (_testIt(/linux/i, subUA)) {
            ret.os = "linux";
          } else {
            if (_testIt(/rhino/i, subUA)) {
              ret.os = "rhino";
            }
          }
          if (_testIt(/KHTML/, subUA)) {
            ret.webkit = 1;
          }
          if (_testIt(/IEMobile|XBLWP7/, subUA)) {
            ret.mobile = "windows";
          }
          if (_testIt(/Fennec/, subUA)) {
            ret.mobile = "gecko";
          }
          match = _matchIt(subUA, /AppleWebKit\/([^\s]*)/, 1);
          if (match) {
            ret.webkit = _numberify(match);
            ret.safari = ret.webkit;
            if (_testIt(/PhantomJS/, subUA)) {
              match = _matchIt(subUA, /PhantomJS\/([^\s]*)/, 1);
              if (match) {
                ret.phantomjs = _numberify(match);
              }
            }
            if (_testIt(RegExp(" Mobile\\/"), subUA) || _testIt(/iPad|iPod|iPhone/, subUA)) {
              ret.mobile = "Apple";
              match = _matchIt(subUA, /OS ([^\s]*)/, 1);
              match = match && _numberify(match.replace("_", "."));
              ret.ios = match;
              ret.ipad = ret.ipod = ret.iphone = 0;
              match = _matchIt(subUA, /iPad|iPod|iPhone/, 0);
              if (match) {
                ret[match.toLowerCase()] = ret.ios;
              }
            } else {
              match = _matchIt(subUA, /NokiaN[^\/]*|Android \d\.\d|webOS\/\d\.\d/, 0);
              if (match) {
                ret.mobile = match;
              }
              if (_testIt(/webOS/, subUA)) {
                ret.mobile = "WebOS";
                match = _matchIt(subUA, /webOS\/([^\s]*);/, 1);
                if (match) {
                  ret.webos = _numberify(match);
                }
              }
              if (_testIt(RegExp(" Android"), subUA)) {
                ret.mobile = "Android";
                match = _matchIt(subUA, /Android ([^\s]*);/, 1);
                if (match) {
                  ret.android = _numberify(match);
                }
              }
              if (_testIt(/Silk/, subUA)) {
                match = _matchIt(subUA, /Silk\/([^\s]*)\)/, 1);
                if (match) {
                  ret.silk = _numberify(match);
                }
                if (!ret.android) {
                  ret.android = 2.34;
                  ret.os = "Android";
                }
                if (_testIt(/Accelerated=true/, subUA)) {
                  ret.accel = true;
                }
              }
            }
            match = subUA.match(/(Chrome|CrMo)\/([^\s]*)/);
            if (match && match[1] && match[2]) {
              ret.chrome = _numberify(match[2]);
              ret.safari = 0;
              if (match[1] === "CrMo") {
                ret.mobile = "chrome";
              }
            } else {
              match = _matchIt(subUA, /AdobeAIR\/([^\s]*)/);
              if (match) {
                ret.air = match[0];
              }
            }
          }
          if (!ret.webkit) {
            match = _matchIt(subUA, /Opera[\s\/]([^\s]*)/, 1);
            if (match) {
              ret.opera = _numberify(match);
              match = _matchIt(subUA, /Opera Mini[^;]*/, 0);
              if (match) {
                ret.mobile = match;
              }
            } else {
              match = _matchIt(subUA, /MSIE\s([^;]*)/, 1);
              if (match) {
                ret.ie = _numberify(match);
              } else {
                match = _matchIt(subUA, /Gecko\/([^\s]*)/);
                if (match) {
                  ret.gecko = 1;
                  match = _matchIt(subUA, /rv:([^\s\)]*)/, 1);
                  if (match) {
                    ret.gecko = _numberify(match);
                  }
                }
              }
            }
          }
        }
        try {
          date.setTime(date.getTime() + 1000);
          theDocument.cookie = cstr(["sf_ck_tst=test; expires=", date.toGMTString(), "; path=/"]);
          if (theDocument.cookie.indexOf("sf_ck_tst") !== -1) {
            ret.cks = true;
          }
        } catch (_error) {
          e = _error;
          ret.cks = false;
        }
        try {
          if (typeof process === "object") {
            if (process.versions && process.versions.node) {
              ret.os = process.platform;
              ret.nodejs = numberify(process.versions.node);
            }
          }
        } catch (_error) {
          e = _error;
          ret.nodejs = 0;
        }
        return ret;
      };

      /*
      The major version number of the Internet Explorer browser being used, or 0 if not.
      
      @name $sf.env.ua.ie
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the Opera browser being used, or 0 if not.<br />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      @name $sf.env.ua.opera
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the Gecko (Firefox) browser being used, or 0 if not.
      @name $sf.env.ua.gecko
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the WebKit browser being used, or 0 if not.
      @name $sf.env.ua.webkit
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the Safari browser being used, or 0 if not.
      @name $sf.env.ua.safari
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the Chrome browser being used, or 0 if not.
      @name $sf.env.ua.chrome
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the AIR SDK being used, or 0 if not.
      @name $sf.env.ua.air
      @type {Number}
      @public
      @static
       */

      /*
      Whether or not an iPod device is being used, 0 for false, &gt; 0 == true
      @name $sf.env.ua.ipod
      @type {Number}
      @public
      @static
       */

      /*
      Whether or not an iPad device is being used, 0 for false, &gt; 0 == true
      @name $sf.env.ua.ipad
      @type {Number}
      @public
      @static
       */

      /*
      Whether or not an iPhone device is being used, 0 for false, &gt; 0 == true
      @name $sf.env.ua.iphone
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the Android OS being used, or 0 if not.
      @name $sf.env.ua.android
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the WebOS being used, or 0 if not.
      @name $sf.env.ua.webos
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the Silk browser being used, or 0 if not.
      @name $sf.env.ua.silk
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the NodeJS environment being used, or 0 if not.
      @name $sf.env.ua.nodejs
      @type {Number}
      @public
      @static
       */

      /*
      The major version number of the PhantomJS environment being used, or 0 if not.
      @name $sf.env.ua.phantomjs
      @type {Number}
      @public
      @static
       */

      /*
      A string representing whether or not the browser / os is a mobile device  and it's type. Possible values are 'windows', 'android', 'symbos', 'linux', 'macintosh', 'rhino', 'gecko', 'Apple', 'chrome'.
      
      @name $sf.env.ua.mobile
      @type {String}
      @public
      @static
       */

      /*
      The major version number of the iOS being used, or 0 if not.
      @name $sf.env.ua.ios
      @type {Number}
      @public
      @static
       */

      /*
      Whether or not the browser / environment in question is hardware accelerated.
      @name $sf.env.ua.accel
      @type {Boolean}
      @public
      @static
       */

      /*
      The major version number of the CAJA environment or 0 if not
      @name $sf.env.ua.cajaVersion
      @type {Number}
      @public
      @static
       */
      cached_ua = parse_ua();
      cached_ua.parse = parse_ua;
      return cached_ua;
    })();
    return {
      ua: ua,
      isIE: isIE
    };
  });

}).call(this);

// Generated by CoffeeScript 1.7.1
(function() {
  define('shared/dom',["./lang", "./env"], function(lang, env) {
    var BLANK_URL, EVT_CNCL_METHODS, GC, IE_GC_INTERVAL, IFRAME, append, attach, attr, clone_iframe, css, detach, doc, dom_is_ready, dom_last_known_child_node, dom_last_known_tag_count, dom_ready_chk_max_tries, dom_ready_chk_timer_id, dom_ready_chk_tries, dom_ready_chk_try_interval, elt, evtCncl, evtTgt, evt_tgt_prop_a, evt_tgt_prop_b, gc, gc_timer_id, ie_attach, ie_detach, iframe_cbs_attached, iframe_msg_host_lib, iframe_next_id, iframe_view, isIE, make_element, make_iframe, par, purge, ready, replace_iframe, tagName, tags, theDocument, useOldStyleAttrMethods, use_attach, use_detach, use_ie_old_attach, view, w3c_attach, w3c_detach, wait, win, _bind_iframe_onload, _byID, _call_xmsg_host, _callable, _clear_ready_timer_check, _clone_iframe, _cstr, _env, _handle_dom_load_evt, _lang, _ready_state_check, _unbind_iframe_onload;
    _lang = lang;
    _env = env;
    win = typeof window !== "undefined" && window !== null ? window : this;
    IFRAME = "iframe";
    GC = "CollectGarbage";
    ie_attach = "attachEvent";
    w3c_attach = "addEventListener";
    ie_detach = "detachEvent";
    w3c_detach = "removeEventListener";
    use_attach = "";
    use_detach = "";
    use_ie_old_attach = false;
    IE_GC_INTERVAL = 3000;
    EVT_CNCL_METHODS = {
      "preventDefault": 0,
      "stopImmediatePropagation": 0,
      "stopPropagation": 0,
      "preventBubble": 0
    };
    isIE = env.isIE;
    useOldStyleAttrMethods = false;
    gc_timer_id = 0;
    dom_is_ready = null;
    dom_last_known_tag_count = 0;
    dom_last_known_child_node = null;
    dom_ready_chk_max_tries = 300;
    dom_ready_chk_try_interval = 50;
    dom_ready_chk_tries = 0;
    dom_ready_chk_timer_id = 0;
    iframe_next_id = 0;
    iframe_cbs_attached = {};
    evt_tgt_prop_a = "";
    evt_tgt_prop_b = "";
    iframe_msg_host_lib = null;
    theDocument = win.document;
    BLANK_URL = "about:blank";
    _cstr = lang.cstr;
    _callable = lang.callable;

    /*
    Clear out the timer function used as a fallback when ready state of the DOM
    cannot be directly detected
    
    @name $sf.lib.dom-_clear_ready_timer_check
    @private
    @static
    @function
     */
    _clear_ready_timer_check = function() {
      if (dom_ready_chk_timer_id) {
        clearTimeout(dom_ready_chk_timer_id);
        dom_ready_chk_timer_id = 0;
      }
    };
    _handle_dom_load_evt = function(evt) {
      detach(win, "load", _handle_dom_load_evt);
      detach(win, "DOMContentLoaded", _handle_dom_load_evt);
      dom_is_ready = true;
    };

    /*
    Checks to see if the DOM is ready to be manipulated, without the need for event hooking.
    Often times you'll see folks use the onload event or DOMContentLoaded event.  However
    the problem with those, is that your JavaScript code may have been loaded asynchronously,
    after either one of those events have fired, and in which case you still don't know if the DOM is really
    ready.  Most modern browsers (including IE), implement a document.readyState property that we can
    check, but not all.  In the case where this property is not implemented, we do a series of node
    checks and tag counts via timers.  Of course this means that on the very 1st call, we will always
    appear to be not ready eventhough the DOM itself may be in a ready state, but our timeout interval
    is small enough that this is OK.
    
    @name $sf.lib.dom-_ready_state_check
    @private
    @static
    @function
     */
    _ready_state_check = function() {
      var b, e, kids, lst, tag_cnt;
      _clear_ready_timer_check();
      if (dom_ready_chk_tries >= dom_ready_chk_max_tries) {
        dom_last_known_child_node = null;
        dom_is_ready = true;
      }
      if (dom_is_ready === null) {
        try {
          b = theDocument && theDocument.body;
          kids = b && tags("*", b);
          tag_cnt = kids && kids[LEN];
          lst = b && b.lastChild;
        } catch (_error) {
          e = _error;
          dom_last_known_tag_count = 0;
          dom_last_known_child_node = null;
        }
        if (dom_last_known_tag_count && tag_cnt === dom_last_known_tag_count && lst === dom_last_known_child_node) {
          dom_last_known_child_node = null;
          dom_is_ready = true;
        } else {
          dom_last_known_tag_count = tag_cnt;
          dom_last_known_child_node = lst;
          dom_ready_chk_tries += 1;
          dom_ready_chk_timer_id = setTimeout(_ready_state_check, dom_ready_chk_try_interval);
        }
      } else {
        dom_last_known_child_node = null;
      }
    };

    /*
    Detach onload handlers on iframes that we have created
    
    @name $sf.lib.dom.iframes-_unbind_iframe_onload
    @private
    @static
    @function
    @param {HTMLElement} el the iframe element to unbind from
     */
    _unbind_iframe_onload = function(el) {
      var id, oldCB;
      id = attr(el, "id");
      oldCB = void 0;
      oldCB = id && iframe_cbs_attached[id];
      if (oldCB) {
        detach(el, "load", oldCB);
        iframe_cbs_attached[id] = null;
        delete iframe_cbs_attached[id];
      }
    };

    /*
    A default onload event handler for IFrames. We don't
    want to attach to onload events for IFrames via attributes
    b/c we don't want others to see what handlers are there.
    In turn we also make sure the "this" reference for the outside
    handle gets set properly, and it allows us to make sure
    that unbinding of the event handler also gets handled always
    so as not to create memory leak issues.
    
    @name $sf.lib.dom.iframes-_bind_iframe_onload
    @private
    @static
    @function
    @param {HTMLElement} el the iframe element to bind too
    @param {Function} cb The onload handler from the outside
     */
    _bind_iframe_onload = function(el, cb) {
      var id, newCB;
      newCB = void 0;
      id = void 0;
      if (_callable(cb)) {

        /*
        @ignore
         */
        newCB = function(evt) {
          var e, tgt;
          tgt = evtTgt(evt);
          e = void 0;
          _unbind_iframe_onload(tgt);
          if (tgt && cb) {
            try {
              cb.call(tgt, evt);
            } catch (_error) {}
          }
          tgt = el = cb = newCB = id = null;
        };
        id = attr(el, "id");
        _unbind_iframe_onload(el);
        if (id) {
          iframe_cbs_attached[id] = newCB;
        }
        attach(el, "load", newCB);
      }
      newCB = null;
    };

    /*
    Return the element reference passed in, and if its a string value passed
    in use that to lookup the element by id attribute.
    
    @name $sf.lib.dom-_byID
    @private
    @static
    @function
    @param {HTMLElement|String} el  the element id / element reference
    @return {HTMLElement|el}
     */
    _byID = function(el) {
      if (el && typeof el === "string") {
        return elt(el) || el;
      } else {
        return el;
      }
    };

    /*
    A proxy wrapper for calling into the cross-domain messaging host library
    
    @name $sf.lib.dom.iframes-_call_xmsg_host
    @private
    @static
    @function
    @param {String} methName The method name in the msg host library to call
    @param {*} arg1 An arbitrary argument to pass to said method as the 1st arg
    @param {*} arg2 An arbitrary argument to pass to said method as the 2nd arg
    @param {*} arg3 An arbitrary argument to pass to said method as the 3rd arg
    @return {*} whatever comes back from the method
     */
    _call_xmsg_host = function(methName, arg1, arg2, arg3) {
      var e;
      e = void 0;
      try {
        if (!iframe_msg_host_lib) {
          iframe_msg_host_lib = dom.msghost;
        }
      } catch (_error) {
        e = _error;
        iframe_msg_host_lib = null;
      }
      if (win !== top) {
        return;
      }
      return methName && iframe_msg_host_lib && iframe_msg_host_lib[methName] && iframe_msg_host_lib[methName](arg1, arg2, arg3);
    };

    /*
    Retrieve a document for a given HTML Element
    
    @memberOf $sf.lib.dom
    @exports doc as $sf.lib.dom.doc
    @static
    @public
    @function
    @param {HTMLElement} el the HTML element for which you wish to find it's parent document
    @return {Document|null} null if nothing found
     */
    doc = function(el) {
      var d, e;
      d = null;
      try {
        if (el) {
          if (el.nodeType === 9) {
            d = el;
          } else {
            d = el.document || el.ownerDocument || null;
          }
        }
      } catch (_error) {
        e = _error;
        d = null;
      }
      return d;
    };

    /*
    Retrieve the host window object for a given HTML Element/document. Note that this is NOT the same as $sf.lib.dom.iframes.view, which
    returns the window reference INSIDE the IFRAME element.
    
    @memberOf $sf.lib.dom
    @exports view as $sf.lib.dom.view
    @public
    @static
    @function
    @param {HTMLElement|HTMLDocument} el the HTML element/document for which you wish to find it's parent window
    @return {Document|null} null if nothing found
     */
    view = function(el) {
      var d, e, prop1, prop2, w;
      w = null;
      d = void 0;
      prop1 = "parentWindow";
      prop2 = "defaultView";
      try {
        if (el) {
          w = el[prop1] || el[prop2] || null;
          if (!w) {
            d = doc(el);
            w = (d && (d[prop1] || d[prop2])) || null;
          }
        }
      } catch (_error) {
        e = _error;
        w = null;
      }
      return w;
    };

    /*
    Retrieve an element by its ID. . basically a short hand wrapper around document.getElementById.
    
    @memberOf $sf.lib.dom
    @exports elt as $sf.lib.dom.elt
    @public
    @static
    @function
    @param {String} id (Required) the id of the HTML element to find
    @param {HTMLElement|HTMLWindow|HTMLDocument} [par] The parent element,document,window to look for the given element
    @return {HTMLElement|null} null if nothing found
     */
    elt = function(id) {
      var args, dc, len;
      args = arguments;
      len = args.length;
      dc = void 0;
      if (len > 1) {
        dc = doc(args[1]);
      } else {
        dc = theDocument;
      }
      return (dc && dc.getElementById(id)) || null;
    };

    /*
    A wrapper around retrieving the tagName of an HTML element (normalizes values to lower case strings).
    
    @memberOf $sf.lib.dom
    @exports tagName as $sf.lib.dom.tagName
    @static
    @public
    @function
    @param {HTMLElement} el The HTML element for which to get the tag name.
    @return {String} The tag name in all lower case of an HTML element, if it cannot be successfully retrieved, alwasys returns an empty string (which will evaluate to false).
     */
    tagName = function(el) {
      return (el && el.nodeType === 1 && el.tagName.toLowerCase()) || "";
    };

    /*
    A wrapper around retrieving a list of tags by name.
    
    @memberOf $sf.lib.dom
    @exports tags as $sf.lib.dom.tags
    @static
    @public
    @function
    @param {String} name The name of the tags that you wish to look for, note that you can pass in "*" to find all.
    @param {HTMLElement|Document} [parNode] the parent node that you wish to look in
    @return {HTMLElementCollection} List of tags found. Note that is NOT a real JavaScript Array
     */
    tags = function(name, parNode) {
      var e, ret;
      ret = [];
      e = void 0;
      try {
        if (parNode && parNode.getElementsByTagName) {
          ret = parNode.getElementsByTagName(name) || ret;
        } else {
          ret = theDocument.getElementsByTagName(name) || ret;
        }
      } catch (_error) {
        e = _error;
        ret = [];
      }
      return ret;
    };

    /*
    Retrive the parent element of an HTML element
    
    @memberOf $sf.lib.dom
    @exports par as $sf.lib.dom.par
    @public
    @static
    @function
    @param {HTMLElement} el the HTML element to check
    return {HTMLElement} the new reference to the parent element or null
     */
    par = function(el) {
      return el && (el.parentNode || el.parentElement);
    };

    /*
    Retrieve/Set/Delete an element's attribute. Note that this handle's
    slight differences in the way HTML attributes are handled across browsers
    as well as being shorthand
    
    @memberOf $sf.lib.dom
    @exports attr as $sf.lib.dom.attr
    @static
    @public
    @function
    @param {HTMLElement} el the HTML element to manipulate
    @param {String} attrName the attribute to set/get
    @param {String} [attrVal], if specified will set the value of the attribute for this element.  Passing null will remove the attribute completely
    @return {String} the value of the attribute normalized to a string (may be empty)
     */
    attr = function(el, attrName, attrVal) {
      var e;
      e = void 0;
      try {
        if (arguments.length > 2) {
          if (attrVal === null) {
            if (useOldStyleAttrMethods) {
              el.removeAttribute(attrName, 0);
            } else {
              el.removeAttribute(attrName);
            }
          } else {
            attrVal = _cstr(attrVal);
            if (attrName.toLowerCase() === "class") {
              el.className = attrVal;
            } else {
              if (useOldStyleAttrMethods) {
                el.setAttribute(attrName, attrVal, 0);
              } else {
                el.setAttribute(attrName, attrVal);
              }
            }
          }
        } else {
          if (useOldStyleAttrMethods) {
            attrVal = _cstr(el.getAttribute(attrName, 0));
          } else {
            attrVal = _cstr(el.getAttribute(attrName));
          }
        }
      } catch (_error) {
        e = _error;
        attrVal = "";
      }
      return attrVal;
    };

    /*
    Set/Get the CSS text of an HTML element
    
    @memberOf $sf.lib.dom
    @exports css as $sf.lib.dom.css
    @public
    @static
    @function
    @param {HTMLElement} el the HTML element to manipulate
    @param {String} [val] the CSS string to set if specified (e.g. "background-color:transparent;position:absolute;top:0px;left:0px").
    @return {String} the value of the attribute normalized to a string (may be empty)
     */
    css = function(el, val) {
      var e, st;
      st = void 0;
      try {
        st = el.style;
        if (arguments.length > 1) {
          st.cssText = _cstr(val);
        } else {
          val = st.cssText;
        }
      } catch (_error) {
        e = _error;
        val = "";
      }
      return val;
    };

    /*
    Make a new element
    
    @name $sf.lib.dom.make
    @exports make_element as $sf.lib.dom.make
    @static
    @public
    @function
    @param {String} tagName
    @param {Document|HTMLElement|Window} [parent] element, document, or window to make the tag in, optional.
    @return {HTMLElement}
     */
    make_element = function(tagName, par) {
      return ((arguments.length > 1 && doc(par)) || theDocument).createElement(tagName);
    };

    /*
    Append and HTMLElement to another HTMLElement
    
    @memberOf $sf.lib.dom
    @exports append as $sf.lib.dom.append
    @public
    @static
    @function
    @param {HTMLElement} parNode the HTML element to manipulate
    @param {HTMLElement} child (Required) the new HTML element to add to the parent
    return {HTMLElement|Boolean} the new reference to the child element that was appended, or false if failure
     */
    append = function(parNode, child) {
      var e, success;
      success = false;
      e = void 0;
      try {
        if (parNode) {
          success = parNode.appendChild(child);
        }
      } catch (_error) {
        e = _error;
        success = false;
      }
      return success;
    };

    /*
    A wrapper method for removing elements from a document rather than calling parentNode.removeChild raw.
    Has special processing to ensure that contents of IFRAME tags gets released from memory as well
    
    @memberOf $sf.lib.dom
    @exports purge as $sf.lib.dom.purge
    @static
    @public
    @function
    @param {HTMLElement} node The HTML element to be removed from the dom
    @return {Boolean} Whether or not the element was successfully removed
     */
    purge = function(node) {
      var e, isIFrame, parNode, success;
      success = false;
      parNode = void 0;
      isIFrame = tagName(node) === IFRAME;
      e = void 0;
      if (isIFrame) {
        _call_xmsg_host("detach", node);
        _unbind_iframe_onload(node);
        if (!isIE) {
          attr(node, "src", BLANK_URL);
        }
      }
      try {
        parNode = par(node);
        if (parNode) {
          parNode.removeChild(node);
          success = true;
          if (isIE && isIFrame) {
            gc();
          }
        }
      } catch (_error) {}
      node = parNode = null;
      return success;
    };

    /*
    Attach an event handler to an HTMLElement.  Note normalize event names to lower case / w3c standards.
    See example.
    
    @memberOf $sf.lib.dom
    @exports attach as $sf.lib.dom.attach
    @public
    @static
    @function
    @param {HTMLElement} el the HTML element to attach an event handler too
    @param {String} name the name of the event to listen too
    @param {Function} cb the function used to handle the particular event
    
    @example
    var el = $sf.lib.dom.elt("my_element");
    function handle_click(evt)
    {
    alert('i was clicked');
    }
    
    $sf.lib.dom.attach(el,"click",handle_click);
     */
    attach = function(obj, name, cb) {
      try {
        if (use_ie_old_attach) {
          obj[use_attach]("on" + name, cb);
        } else {
          obj[use_attach](name, cb, false);
        }
      } catch (_error) {}
      obj = cb = null;
    };

    /*
    Detach an event handler to an HTMLElement
    
    @memberOf $sf.lib.dom
    @exports detach as $sf.lib.dom.detach
    @public
    @static
    @function
    @param {HTMLElement} el the HTML element to attach an event handler too
    @param {String} namethe name of the event to listen too
    @param {Function} cb the function used to handle the particular event
     */
    detach = function(obj, name, cb) {
      try {
        if (use_ie_old_attach) {
          obj.detachEvent("on" + name, cb);
        } else {
          obj.removeEventListener(name, cb, false);
        }
      } catch (_error) {}
      obj = cb = null;
    };

    /*
    Returns whether or not the DOM is ready to be manipulated
    
    @memberOf $sf.lib.dom
    @exports ready as $sf.lib.dom.ready
    @public
    @static
    @function
    @return {Boolean}
     */
    ready = function() {
      var rs;
      rs = void 0;
      _clear_ready_timer_check();
      if (dom_is_ready) {
        dom_last_known_child_node = null;
        return true;
      }
      rs = theDocument.readyState;
      if (rs) {
        dom_last_known_child_node = null;
        if (rs === "loaded" || rs === "complete") {
          dom_is_ready = true;
        } else {
          dom_is_ready = false;
        }
      }
      dom_last_known_child_node = null;
      dom_ready_chk_tries = dom_last_known_tag_count = 0;
      _ready_state_check();
      return !!dom_is_ready;
    };

    /*
    Fire off a particular function when it is detected that the DOM is ready
    Useful when you don't know for sure if the DOM of the browser is ready or not, so this will detect and fire
    your function for you.
    
    @memberOf $sf.lib.dom
    @exports wait as $sf.lib.dom.wait
    @public
    @static
    @function
    @param {Function} cb A function reference to be called when the DOM is ready
     */
    wait = function(cb) {
      var e, rdy;
      rdy = ready();
      e = void 0;
      if (rdy) {
        try {
          if (lang.callable(cb)) {
            cb();
          }
        } catch (_error) {
          e = _error;
          e = null;
        }
        return;
      }
      setTimeout((function() {
        wait(cb);
        cb = null;
      }), dom_ready_chk_try_interval + 1);
    };

    /*
    Cancel the the default action of a particular DOM event
    
    @memberOf $sf.lib.dom
    @exports evtCncl as $sf.lib.dom.evtCncl
    @public
    @static
    @function
    @param {HTMLEvent} evt  The raw HTML event
     */
    evtCncl = function(evt) {
      var e, prop;
      prop = "";
      e = void 0;
      evt = evt || win.event;
      if (evt) {
        try {
          evt.returnValue = false;
        } catch (_error) {}
        try {
          evt.cancelBubble = true;
        } catch (_error) {}
        try {
          evt.stopped = true;
        } catch (_error) {}
        for (prop in EVT_CNCL_METHODS) {
          if (EVT_CNCL_METHODS[prop]) {
            try {
              evt[prop]();
            } catch (_error) {}
          }
        }
      }
      return false;
    };

    /*
    Return the target/srcElement of an event from an HTML element
    
    @memberOf $sf.lib.dom
    @exports evtTgt as $sf.lib.dom.evtTgt
    @public
    @static
    @function
    @param {HTMLEvent} evt The raw HTML event
     */
    evtTgt = function(evt) {
      var e, tgt;
      tgt = null;
      try {
        evt = evt || win.event;
        tgt = (evt ? evt[evt_tgt_prop_a] || evt[evt_tgt_prop_b] : null);
      } catch (_error) {
        e = _error;
        tgt = null;
      }
      return tgt;
    };

    /*
    @namespace $sf.lib.dom.iframes Defines helper functions for dealing specifically with IFRAME tags, which is key to SafeFrames tech in a browser.
    @name $sf.lib.dom.iframes
    @requires $sf.lib.lang
     */

    /*
    Clones an iframe. . .
    This code creates / clones iframe tags in a very specific way to ensure both optimal performance and stability.
    We use string buffers to build markup internally, which is typically faster than using all DOM APIs.  Also
    we allow the usage of the "name" attribute as a data pipeline, which in turn allows for synchronous downward
    x-domain messaging.
    
    @name $sf.lib.dom.iframes.clone
    @static
    @public
    @function
    @param {HTMLElement/String} el  An iframe element or id of an iframe element to clone
    @param {Object} [attrs]  A hash map of other attributes to be set on the iframe.  Do not set style properties for the frame here, see the next argument for that.
    @param {String} [cssText]  The style string (as in what you would use in HTML markup, e.g. "background-color:red;border:solid 3px blue;"), to use for this iframe
    @param {Function} [cb]  An optional callback function to specify for when the iframe loads.
    @param {Function} [xmsgCB] An optional call back for receiving messages from the iframe
    @return {HTMLElement}  the iframe node if succesfully created or null.  Note that this does not insert the iframe into the document for you. . .
     */
    clone_iframe = function(el, attrs, cssText, cb, xmsgCB) {
      return _clone_iframe(el, attrs, cssText, cb, xmsgCB);
    };

    /*
    @ignore
     */
    _clone_iframe = function(el, attrs, cssText, cb, xmsgCB, iframe_skip_clone) {
      var attrStr, bufferHTML, cl, html, newCl, prop, temp, xmsgPipe;
      bufferHTML = ["<", IFRAME, " "];
      xmsgPipe = "";
      prop = void 0;
      temp = void 0;
      cl = void 0;
      newCl = void 0;
      html = void 0;
      attrStr = void 0;
      if (!iframe_skip_clone) {
        el = _byID(el);
        if (tagName(el) !== IFRAME) {
          return null;
        }
        cl = el.cloneNode(false);
      } else {
        cl = el;
      }
      attrs = attrs || {};
      if ("src" in attrs) {
        attr(cl, "src", null);
      } else {
        attrs.src = attr(el, "src") || BLANK_URL;
      }
      if ("name" in attrs) {
        attr(cl, "name", null);
      } else {
        attrs.name = attr(el, "name");
      }
      if (!attrs.src) {
        attrs.src = BLANK_URL;
      }
      xmsgPipe = xmsgCB && _call_xmsg_host("prep", attrs);
      if (!iframe_skip_clone) {
        attr(cl, "width", null);
        attr(cl, "height", null);
      }
      if (cssText) {
        temp = css(cl);
        if (temp && temp.charAt(temp.length - 1) !== ";") {
          temp += ";";
        }
        css(cl, [temp, _cstr(cssText)]);
      }
      temp = make_element("div");
      append(temp, cl);
      html = temp.innerHTML;
      attrStr = html.replace(/<iframe(.*?)>(.*?)<\/iframe>/g, "$1");
      bufferHTML.push("name=\"", attrs.name, "\" ", attrStr, "></", IFRAME, ">");
      delete attrs.name;
      temp.innerHTML = _cstr(bufferHTML);
      newCl = temp.firstChild;
      for (prop in attrs) {
        attr(newCl, prop, attrs[prop]);
      }
      if (!attr(newCl, "id")) {
        attr(newCl, "id", "sf_" + IFRAME + "_" + iframe_next_id);
        iframe_next_id++;
      }
      attr(newCl, "FRAMEBORDER", "no");
      attr(newCl, "SCROLLING", "no");
      attr(newCl, "ALLOWTRANSPARENCY", true);
      attr(newCl, "HIDEFOCUS", true);
      attr(newCl, "TABINDEX", -1);
      attr(newCl, "MARGINWIDTH", 0);
      attr(newCl, "MARGINHEIGHT", 0);
      _bind_iframe_onload(newCl, cb);
      if (xmsgPipe) {
        _call_xmsg_host("attach", newCl, xmsgPipe, xmsgCB);
      }
      xmsgPipe = xmsgCB = cl = cb = el = temp = null;
      return newCl;
    };

    /*
    Make a new iframe
    
    @name $sf.lib.dom.iframes.make
    @static
    @public
    @function
    @param {Object} attrs  A hash map of other attributes to be set on the iframe.  Do not set style properties for the frame here, see the next argument for that.
    @param {String} [cssText]  The style string (as in what you would use in HTML markup, e.g. "background-color:red;border:solid 3px blue;"), to use for this iframe
    @param {Function} [cb]  An callback function to specify for when the iframe loads.
    @param {Function} [xmsgCB] An call back for receiving messages from the iframe
    @return {HTMLElement}  the iframe node if succesfully created or null.  Note that this does not insert the iframe into the document for you. . .
     */
    make_iframe = function(attrs, cssText, cb, xmsgCB) {
      return _clone_iframe(make_element(IFRAME), attrs, cssText, cb, xmsgCB, true);
    };

    /*
    A method to insert or replace an HTML tag with an IFRAME tag, with a new URL and attributes.
    
    Used for 3 reasons:
    <ol>
    <li>It avoids click sounds on IE.</li>
    <li>It allows always resetting the window.name property of the iframes underlying HTMLWindow object, unforunately IE will not let you set this attribute on a clone.</li>
    <li>It ensures that event handlers in the underlying document for unloading are executed.</li>
    <li>Changing the src attribute directly will result in a browser history update, which we do not want.</li>
    </ol>
    
    We could just change location.href property or call location.replace, however that is not always  possible since
    the frame could be x-domain.
    
    @name $sf.lib.dom.iframes.replace
    @function
    @static
    @public
    @param {Object} attrs  A hash map of other attributes to be set on the iframe.  Do not set style properties for the frame here, see the next argument for that.
    @param {String} [cssText]  The style string (as in what you would use in HTML markup, e.g. "background-color:red;border:solid 3px blue;"), to use for this iframe
    @param {HTMLElement|String} [parRef]  An parent element or parent element id, to be used only if a new iframe is created, the iframe will be append to that parent, if not specified document body is used
    @param {Function} [cb]  An callback function to specify for when the iframe loads.
    @param {Function} [xmsgCB] An call back for receiving messages from the iframe
    
    @return {HTMLElement} a reference to the newly created iframe element if successfully inserted, otherwise null.
     */
    replace_iframe = function(attrs, cssText, parRef, cb, xmsgCB) {
      var cl, e, el, elID, frameEl, parNode, tgn;
      cl = void 0;
      el = void 0;
      frameEl = void 0;
      elID = void 0;
      tgn = void 0;
      parNode = void 0;
      e = void 0;
      attrs = attrs || {};
      elID = attrs.id;
      el = elID && _byID(elID);
      tgn = tagName(el);
      el = (tgn ? el : null);
      frameEl = (tgn === IFRAME ? el : null);
      if (frameEl) {
        _call_xmsg_host("detach", frameEl);
        _unbind_iframe_onload(frameEl);
        parNode = par(frameEl);
        cl = clone_iframe(frameEl, attrs, cssText, cb, xmsgCB);
        attr(cl, "onload", null);
        attr(cl, "onreadystatechange", null);
      } else {
        if (parRef) {
          parRef = _byID(parRef);
          if (tagName(parRef)) {
            parNode = parRef;
          }
        }
        if (!parNode && el) {
          parNode = par(el);
        }
        cssText = _cstr(cssText) || css(el) || "";
        cl = make_iframe(attrs, cssText, cb, xmsgCB);
      }
      try {
        if (!parNode) {
          append(theDocument.body, cl);
        } else {
          if (frameEl) {
            parNode.replaceChild(cl, frameEl);
          } else {
            if (el) {
              parNode.replaceChild(cl, el);
            } else {
              append(parNode, cl);
            }
          }
        }
      } catch (_error) {}
      cl = el = attrs = frameEl = parNode = cb = null;
      return elt(elID);
    };

    /*
    Retrieve the window reference inside of an IFRAME. Not to be confused with $sf.lib.dom.view which
    returns the parent window reference of an element.
    
    Note that even in cross-domain scenarios, you are supposed to able to get access to the window reference.
    In a cross-domain scenario, you would not be able to then acesss most properties / methods / objects of that
    window, but the reference itself is allowed.
    
    @name $sf.lib.dom.iframes.view
    @public
    @static
    @function
    @param {HTMLElement} el The iframe element to safely get back the window
    @return {HTMLWindow} the window reference inside the iframe.
     */
    iframe_view = function(el) {
      var e, elDoc, elWin, err, fe, frame, frame_list, idx;
      win = void 0;
      elWin = void 0;
      elDoc = void 0;
      frame_list = void 0;
      frame = void 0;
      fe = void 0;
      idx = 0;
      e = void 0;
      err = void 0;
      try {
        win = el.contentWindow || null;
        if (!win) {
          elDoc = doc(el);
          elWin = elDoc && view(elDoc);
          frame_list = (elWin && elWin.frames) || [];
          while (frame = frame_list[idx++]) {
            try {
              fe = frame.frameElement;
            } catch (_error) {
              err = _error;
              fe = null;
            }
            if (fe && fe === el) {
              win = frame;
              break;
            }
          }
        }
      } catch (_error) {
        e = _error;
        win = null;
      }
      return win;
    };

    /*
    @ignore
     */
    gc = _lang.noop;
    (function() {
      var ATTR_NAME, CREATE_EVENT, EVT_TYPE, err, obj, prop;
      obj = void 0;
      ATTR_NAME = "SCROLLING";
      CREATE_EVENT = "createEvent";
      EVT_TYPE = "UIEvent";
      prop = void 0;
      err = void 0;
      if (isIE) {
        evt_tgt_prop_a = "srcElement";
        evt_tgt_prop_b = "target";
        obj = make_element(IFRAME);
        attr(obj, ATTR_NAME, "no");
        useOldStyleAttrMethods = attr(obj, ATTR_NAME) !== "no";
        if (GC in win) {

          /*
          @ignore
           */
          gc = function() {
            if (gc_timer_id) {
              clearTimeout(gc_timer_id);
            }
            gc_timer_id = setTimeout(function() {
              try {
                win[GC]();
              } catch (_error) {}
            }, IE_GC_INTERVAL);
          };
        } else {
          gc = _lang.noop;
        }
      } else {
        evt_tgt_prop_a = "target";
        evt_tgt_prop_b = "currentTarget";
      }
      if (win[w3c_attach] && !isIE) {
        use_attach = w3c_attach;
        use_detach = w3c_detach;
      } else if (isIE) {
        use_ie_old_attach = true;
        use_attach = ie_attach;
        use_detach = ie_detach;
      }
      obj = null;
      try {
        obj = theDocument[CREATE_EVENT](EVT_TYPE);
      } catch (_error) {
        err = _error;
        obj = null;
      }
      if (!obj) {
        try {
          obj = theDocument[CREATE_EVENT](EVT_TYPE + "s");
        } catch (_error) {
          err = _error;
          obj = null;
        }
      }
      if (obj) {
        for (prop in EVT_CNCL_METHODS) {
          if (obj[prop]) {
            EVT_CNCL_METHODS[prop] = 1;
          }
        }
      }
      obj = null;
      attach(win, "load", _handle_dom_load_evt);
      return attach(win, "DOMContentLoaded", _handle_dom_load_evt);
    })();
    return {
      doc: doc,
      view: view,
      elt: elt,
      tagName: tagName,
      tags: tags,
      par: par,
      make: make_element,
      css: css,
      attr: attr,
      gc: gc,
      append: append,
      purge: purge,
      attach: attach,
      detach: detach,
      ready: ready,
      wait: wait,
      evtCncl: evtCncl,
      evtTgt: evtTgt,
      iframes: {
        make: make_iframe,
        clone: clone_iframe,
        replace: replace_iframe,
        view: iframe_view
      }
    };
  });

}).call(this);

// Generated by CoffeeScript 1.7.1
(function() {
  define('shared/logger',[], function() {
    var logError, logInfo, win;
    win = typeof window !== "undefined" && window !== null ? window : this;

    /*
    Write an entry to the console log and fire any log listeners
    
    @message  The log message
     */
    logInfo = function(message) {
      if (win.console && console.log) {
        console.log(message);
      }
    };

    /*
    Write an entry to the console error log and fire any log listeners
    
    @message  The log message
     */
    logError = function(message) {
      if (win.console && console.error) {
        console.error(message);
      } else {
        if (win.console && console.log) {
          console.log(message);
        }
      }
    };
    return {
      info: logInfo,
      error: logError
    };
  });

}).call(this);

// Generated by CoffeeScript 1.7.1
(function() {
  define('shared/base',["./lang", "./env", "./dom", "./logger"], function(lang, env, dom, logger) {
    return {
      ver: "1-1-0",
      specVersion: "1.1",
      lib: {
        lang: lang,
        dom: dom,
        logger: logger
      },
      env: env,
      host: {},
      ext: {},
      info: {
        errs: [],
        list: []
      }
    };
  });

}).call(this);

// Generated by CoffeeScript 1.7.1

/*
@fileOverview This file contains JavaScript code that handles the HTML document where HTML is rendered for a SafeFrame, as well as defining the External Vendor/Client API.
@author <a href="mailto:ssnider@yahoo-inc.com">Sean Snider</a>
@author <a href="mailto:ccole[AT]emination.com">Chris Cole</a>
@version 1.0.3
 */


/*
@namespace $sf.ext The external vendor / client API for functionality inside a SafeFrame
@name $sf.ext
 */


/*
@ignore
 */

(function() {
  define('ext/ext',["../shared/base"], function(sf) {
    var COLLAPSE_COMMAND, DG, DOM_WATCH_INTERVAL, DP, DS, ERROR_COMMAND, EXPAND_COMMAND, GUID_VALID_TIME, IE_ATTACH, IE_DETACH, LOAD, MAX_MSG_WAIT_TIME, MSG, NOTIFY_COLLAPSE, NOTIFY_COLLAPSED, NOTIFY_EXPAND, NOTIFY_FAILURE, NOTIFY_FOCUS_CHANGE, NOTIFY_GEOM_UPDATE, NOTIFY_READ_COOKIE, NOTIFY_WRITE_COOKIE, OBJ, ONLOAD, ONMSG, ONUNLOAD, ON_STR, OUR_TAG_CLS_NAME, ParamHash, STATUS_COLLAPSED, STATUS_COLLAPSING, STATUS_EXPANDED, STATUS_EXPANDING, TOLOWERCASE, UNLOAD, W3C_ATTACH, W3C_DETACH, can_use_html5, collapse, cookie, d, dom, env, err_msg_timer_id, err_msgs, expand, force_collapse, frame_id, geom, geom_info, guid, host_cname, ie_old_attach, ie_old_detach, iframes, inViewPercentage, init_height, init_width, inline_handler_timer_id, isIE, is_expanded, is_registered, lang, lib, loaded, message, meta, msgclient_fb, orphan_timer_id, par, pending_msg, pos_id, pos_meta, register, render_conf, render_params, sandbox_cb, status, supports, unload_handlers, w3c_old_attach, w3c_old_detach, win, winHasFocus, win_has_focus, _append, _attach, _attach_override, _attr, _call_client_fb, _call_raw_evt_func, _check_orphaned, _cnum, _collapse, _construction, _create_stylesheet, _cstr, _destruction, _detach, _detach_override, _detect_bad_iframe, _elt, _fire_sandbox_callback, _handle_err, _handle_load, _handle_msg, _handle_unload, _nuke_doc, _purge, _receive_msg, _render, _report_errs, _reset_inline_handlers, _send_msg, _set_alignment, _set_hyperlink_targets, _setup_win_evt_props, _tags, _ue;
    win = typeof window !== "undefined" && window !== null ? window : this;

    /*
    Creates and appends a style sheet for any custom CSS passed
    
    @name $sf.ext-_create_stylesheet
    @function
    @static
    @private
    @param {String} cssText A string of CSS rules, or a URL string
    @param {String} [id] The id attribute of the tag created and appended
     */
    _create_stylesheet = function(cssText, id) {
      var e, oHead, oSS, oTxt;
      oHead = void 0;
      oSS = void 0;
      oTxt = void 0;
      e = void 0;
      try {
        oHead = _tags("head")[0];
        if (cssText.search(/\{[^\}]*}/g) === -1) {
          oSS = dom.make("link");
          oSS.type = "text/css";
          oSS.rel = "stylesheet";
          oSS.href = cssText;
        } else {
          oSS = dom.make("style");
          oSS.type = "text/css";
          if (isIE) {
            oSS.styleSheet.cssText = cssText;
          } else {
            oTxt = d.createTextNode(cssText);
            _append(oSS, oTxt);
          }
        }
        if (id) {
          oSS.id = id;
        }
        _append(oHead, oSS);
      } catch (_error) {}
    };

    /*
    Fires of unload event handlers and performs the necessary clean up when a SafeFrame is destroyed
    
    @name $sf.ext-_destruction
    @function
    @static
    @private
    @param {HTMLEvent} [evt] The raw dom event object if it exists
     */
    _destruction = function(evt) {
      var d, e, err_msg_timer_id, grand_par, handler, ie_old_attach, ie_old_detach, inline_handler_timer_id, orphan_timer_id, par, success, w, w3c_old_attach, w3c_old_detach, _ue;
      handler = void 0;
      w = window;
      success = 1;
      e = void 0;
      try {
        evt = evt || w.event || {};
      } catch (_error) {
        e = _error;
        evt = {
          type: UNLOAD
        };
      }
      while (handler = unload_handlers.shift()) {
        try {
          handler(evt);
        } catch (_error) {}
      }
      try {
        if (ie_old_attach) {
          w[IE_ATTACH] = ie_old_attach;
          w[IE_DETACH] = ie_old_detach;
        }
      } catch (_error) {}
      try {
        if (w3c_old_attach) {
          w[W3C_ATTACH] = w3c_old_attach;
          w[W3C_DETACH] = w3c_old_detach;
        }
      } catch (_error) {}
      if (!loaded) {
        _detach(w, LOAD, _handle_load);
      }
      _detach(w, UNLOAD, _handle_unload);
      try {
        w.onerror = null;
      } catch (_error) {}
      try {
        if (err_msg_timer_id) {
          clearTimeout(err_msg_timer_id);
          err_msg_timer_id = 0;
        }
      } catch (_error) {}
      try {
        if (orphan_timer_id) {
          clearTimeout(orphan_timer_id);
          orphan_timer_id = 0;
        }
      } catch (_error) {}
      try {
        if (inline_handler_timer_id) {
          clearTimeout(inline_handler_timer_id);
          inline_handler_timer_id = 0;
        }
      } catch (_error) {}
      w = ie_old_attach = w3c_old_attach = ie_old_detach = w3c_old_detach = d = _ue = par = handler = grand_par = null;
      return success;
    };

    /*
    Maintains that the window.onmessage property remains unset.
    We don't want content in our document listening to HTML5 messages.
    We override attaching to listeners below to maintain that functionality,
    however IE won't let you override properties directly hangning off of the
    window object, so we have a timer as a fallback for that purpose
    
    @name $sf.ext-_reset_inline_handlers
    @function
    @static
    @private
     */
    _reset_inline_handlers = function() {
      var e, inline_handler_timer_id;
      e = void 0;
      try {
        if (inline_handler_timer_id) {
          clearTimeout(inline_handler_timer_id);
          inline_handler_timer_id = 0;
        }
      } catch (_error) {}
      try {
        if (isIE && win.onmessage) {
          win.onmessage = null;
        }
      } catch (_error) {}
      try {
        win.onerror = _handle_err;
      } catch (_error) {}
      inline_handler_timer_id = setTimeout(_reset_inline_handlers, DOM_WATCH_INTERVAL);
    };

    /*
    Clears out the HTML document (which will force an unload event as well).
    
    @name $sf.ext-_nuke_doc
    @function
    @static
    @private
     */
    _nuke_doc = function() {
      var e;
      e = void 0;
      try {
        document.open("text/html", "replace");
        document.write("");
        document.close();
      } catch (_error) {}
    };

    /*
    Iteratively checks to see if the IFRAME HTML document is no longer
    attached to the main dom, doing this by checking that our internal
    window reference is still valid. . .as well as running the checks to make
    sure invalid iframes (iframes from origin) are not created.
    
    If we detect that the IFRAME has been removed from the main dom of the
    publisher, then we call to destroy the HTML document, forcing onunload
    event and subsquent cleanup
    
    @name $sf.ext-_check_orphaned
    @function
    @static
    @private
     */
    _check_orphaned = function() {
      var e, is_orphaned, orphan_timer_id;
      is_orphaned = false;
      e = void 0;
      _detect_bad_iframe();
      if (!isIE) {
        return;
      }
      try {
        if (orphan_timer_id && orphan_timer_id !== -1) {
          clearTimeout(orphan_timer_id);
          orphan_timer_id = 0;
        }
      } catch (_error) {}
      try {
        is_orphaned = win === top && orphan_timer_id !== -1;
      } catch (_error) {
        e = _error;
        is_orphaned = false;
      }
      if (is_orphaned) {
        orphan_timer_id = -1;
        _destruction();
        _nuke_doc();
        return;
      }
      try {
        if (!orphan_timer_id) {
          orphan_timer_id = setTimeout(_check_orphaned, DOM_WATCH_INTERVAL);
        }
      } catch (_error) {}
    };

    /*
    Detect whether or not an IFRAME tag has been inserted into the DOM that has the same
    origin / cname as the publisher, which should not be allowed as it's a security issue
    If said IFRAME tag(s) are found, remove them.
    
    @name $sf.ext-_detect_bad_iframe
    @function
    @static
    @private
     */
    _detect_bad_iframe = function() {
      var idx, iframes, srcHost, tag, written;
      iframes = _tags("iframe");
      idx = 0;
      srcHost = "";
      written = false;
      tag = void 0;
      if (host_cname) {
        while (tag = iframes[idx++]) {
          srcHost = _attr(tag, "src");
          srcHost = (srcHost && srcHost.length >= 9 ? srcHost.substring(0, srcHost.indexOf("/", 9))[TOLOWERCASE]() : "");
          if (srcHost && srcHost === host_cname && tag.className !== OUR_TAG_CLS_NAME) {
            try {
              _purge(tag);
            } catch (_error) {}
          }
        }
      }
    };

    /*
    Make sure that all hyperlinks in the document are set with the property "target" attribute
    such that links will navigate to the right window properly.
    
    @name $sf.ext-_set_hyperlink_targets
    @function
    @static
    @private
     */
    _set_hyperlink_targets = function() {
      var atgt, idx, ln, lns, ttgt;
      idx = 0;
      ttgt = (render_conf && render_conf.tgt) || "_top";
      ln = void 0;
      atgt = void 0;
      lns = void 0;
      lns = _tags("a");
      if (ttgt === "_self") {
        ttgt = "_top";
      }
      while (ln = lns[idx++]) {
        atgt = _attr(ln, "target");
        if (atgt !== ttgt) {
          _attr(ln, "target", ttgt);
        }
        if (idx > 10) {
          break;
        }
      }
    };

    /*
    Handle the onunload event from the HTML document of the IFRAME, which in turn will trigger clean up
    
    @name $sf.ext-_handle_unload
    @function
    @static
    @private
    @param {HTMLEvent} evt The raw DOM event object
     */
    _handle_unload = function(evt) {
      _destruction(evt);
      _nuke_doc();
    };

    /*
    Handle the load event from the HTML document of the IFRAME, which will also setup
    to make sure link targets are set properly
    
    @name $sf.ext-_handle_load
    @function
    @static
    @private
     */
    _handle_load = function() {
      var loaded;
      if (loaded) {
        return;
      }
      loaded = true;
      _detach(win, LOAD, _handle_load);
      _set_hyperlink_targets();
    };

    /*
    Handle onmessage HTML5 x-domain events. We always cancel the event
    never allowing it to go to other listeners besides our own, as we don't allow HTML5 messaging
    beyond us and the publisher / host.
    
    @name $sf.ext-_handle_msg
    @function
    @static
    @private
     */
    _handle_msg = function(evt) {
      var e, msg_guid, msg_obj, msg_params, org, src, str;
      str = void 0;
      src = void 0;
      org = void 0;
      e = void 0;
      msg_params = void 0;
      msg_guid = void 0;
      msg_obj = void 0;

      /*
      TODO, also validate origin
       */
      try {
        str = evt.data;
        src = evt.source;
        org = evt.origin;
      } catch (_error) {}
      dom.evtCncl(evt);
      if (str && src && src === top) {
        msg_params = ParamHash(str, null, null, true, true);
        msg_guid = msg_params.guid;
        msg_obj = msg_params.msg;
        if (guid === msg_guid && msg_obj && typeof msg_obj === OBJ) {
          try {
            setTimeout((function() {
              _receive_msg(msg_obj, evt);
              msg_params = evt = msg_guid = msg_obj = null;
            }), 1);
          } catch (_error) {}
        }
      }
    };

    /*
    This SafeFrames implementation internally handles all event attachment to maintain that the listener order
    for events that it cares about (onload, onunload, onbeforeunload, onmessage).
    This is done to make sure that proper clean up and intialization happens, as well as to enforce
    security.
    
    For events that it SafeFrames does not care about we allow the attachment listeners
    to proceed as normal, so we call the raw attachEvent / addEventListener functions.
    
    @name $sf.ext-_call_raw_evt_func
    @function
    @static
    @private
    @param {String} type The name of the event for which to attach/detach a listener
    @param {Function} f The callback function to use as a listener for said event
    @param {Boolean} [remove] If set to true, remove/detach this function as a listener, otherwise add
     */
    _call_raw_evt_func = function(type, f, remove) {
      var bOK, e, ie_f, w3c_f;
      bOK = false;
      ie_f = void 0;
      w3c_f = void 0;
      e = void 0;
      if (remove) {
        ie_f = ie_old_detach || w3c_old_detach;
        w3c_f = w3c_old_detach;
      } else {
        ie_f = ie_old_attach || w3c_old_attach;
        w3c_f = w3c_old_attach;
      }
      if (ie_f) {
        try {
          ie_f(type, f);
          bOK = true;
        } catch (_error) {
          e = _error;
          bOK = false;
        }
        if (!bOK) {
          try {
            ie_f.call(win, type, f);
            bOK = true;
          } catch (_error) {
            e = _error;
            bOK = false;
          }
        }
      }
      if (w3c_f && !bOK) {
        try {
          w3c_f.call(win, type, f, false);
        } catch (_error) {}
      }
    };

    /*
    Override default event attachment, and send load, beforeunload, and unload handlers into our
    own ques, so that we can enforce the proper firing order.  if message event is passed in,
    we do not allow attachment, since we do not want n-party code listening to HTML5 messages
    
    @name $sf.ext-_attach_override
    @function
    @static
    @private
    @param {String} type the event name to listen too
    @param {Function} f The function to be called whenever the event fires
     */
    _attach_override = function(type, f) {
      var bDoDefault;
      bDoDefault = false;
      type = _cstr(type)[TOLOWERCASE]();
      switch (type) {
        case UNLOAD:
        case ONUNLOAD:
          unload_handlers.push(f);
          break;
        case MSG:
        case ONMSG:
          true;
          break;
        default:
          bDoDefault = true;
      }
      if (bDoDefault) {
        _call_raw_evt_func(type, f);
      }
    };

    /*
    Override default event detachment, and remove load, beforeunload, and unload handlers
    from our own que.  if message event is passed in, we do nothing (since we don't alllow
    attachment either).  If not one of those event types, then we call the default event detachment
    
    @name $sf.ext-_detach_override
    @function
    @static
    @private
    @param {String} type the event name to unlisten too
    @param {Function} f The function to no longer be called for the specific event
     */
    _detach_override = function(type, f) {
      var handler, handlers, idx;
      idx = 0;
      handler = void 0;
      handlers = void 0;
      type = _cstr(type)[TOLOWERCASE]();
      switch (type) {
        case UNLOAD:
        case ONUNLOAD:
          handlers = unload_handlers;
          break;
        case MSG:
        case ONMSGif(handlers):
          true;
      }
      if (handlers.length) {
        while (handler = handlers[idx]) {
          if (handler === f) {
            handlers.splice(idx, 1);
            break;
          }
          idx++;
        }
      } else {

      }
      _call_raw_evt_func(type, f, true);
    };

    /*
    Report any internal uncaught JavaScript errors up to the publisher / host
    
    @name $sf.ext-_report_errs
    @static
    @function
    @private
     */
    _report_errs = function() {
      var cmd_str, e, err_msg_timer_id, err_msgs, errs;
      e = void 0;
      errs = void 0;
      try {
        if (err_msgs.length > 0) {
          errs = err_msgs[0];
          cmd_str = ["cmd=", ERROR_COMMAND, "&pos=", pos_id, "&errors=", errs];
          _send_msg(_cstr(cmd_str), ERROR_COMMAND);
        }
        if (err_msg_timer_id) {
          clearTimeout(err_msg_timer_id);
          err_msg_timer_id = 0;
        }
      } catch (_error) {}
      err_msgs = [];
    };

    /*
    Handle any uncaught JavaScript errors
    
    @name $sf.ext-_handle_err
    @static
    @function
    @private
    @param {String} a The the error message / description string
    @param {String} b The URL / file that the JavaScript error occured within
    @param {Number} c The line number that the error occured on. . .
     */
    _handle_err = function(a, b, c) {
      var e, err_msg_timer_id;
      e = void 0;
      err_msgs.push(_cstr(["Error occurred inside SafeFrame:\nMessage: ", a, "\nURL:", b, "\nLine:", c]));
      try {
        if (err_msg_timer_id) {
          clearTimeout(err_msg_timer_id);
          err_msg_timer_id = 0;
        }
        err_msg_timer_id = setTimeout(_report_errs, DOM_WATCH_INTERVAL);
      } catch (_error) {}
      return true;
    };

    /*
    Override native window methods and properties so that we can control
    how the events that we need to manage
    
    @name $sf.ext-_setup_win_evt_props
    @static
    @function
    @private
    @param {Object} obj The window object / prototype
     */
    _setup_win_evt_props = function(obj) {
      var O, e, n, nobj, ret;
      n = lang.noop;
      O = Object;
      nobj = {
        get: n,
        set: n
      };
      ret = false;
      if (obj) {
        if (ie_old_attach) {
          obj[IE_ATTACH] = _attach_override;
          obj[IE_DETACH] = _detach_override;
        }
        if (w3c_old_attach) {
          obj[W3C_ATTACH] = _attach_override;
          obj[W3C_DETACH] = _detach_override;
        }
        if (obj[DG]) {
          try {
            obj[DG](ONLOAD, n);
            obj[DS](ONLOAD, n);
            obj[DG](ONUNLOAD, n);
            obj[DS](ONUNLOAD, n);
            obj[DG](ONMSG, n);
            obj[DS](ONMSG, n);
            ret = true;
          } catch (_error) {
            e = _error;
            ret = false;
          }
        }
        if (!ret && O[DP]) {
          try {
            O[DP](obj, ONLOAD, nobj);
            O[DP](obj, ONUNLOAD, nobj);
            O[DP](obj, ONMSG, nobg);
            ret = true;
          } catch (_error) {
            e = _error;
            ret = false;
          }
        }
      }
      return ret;
    };

    /*
    Intialize / setup the safeframe, the environment according to the configuration found within the serialized
    window.name property.
    
    @name $sf.ext-_construction
    @param {Object} [details] An optional object to pass in status / error information into
    @static
    @private
    @function
     */
    _construction = function(details) {
      var can_use_html5, cont, cur_time, e, el, frame_id, geom_info, guid, guid_time, host_cname, ie_old_attach, ie_old_detach, nm, pos_id, pos_meta, render_conf, render_params, ret, temp, time_delta, w3c_old_attach, w3c_old_detach, win_has_focus;
      cont = false;
      ret = true;
      el = void 0;
      nm = void 0;
      temp = void 0;
      cur_time = void 0;
      guid_time = void 0;
      time_delta = void 0;
      e = void 0;
      details = (details && (details instanceof Object) ? details : {});
      try {
        nm = win.name;
      } catch (_error) {}
      try {
        win.name = "";
      } catch (_error) {}
      if (!nm) {
        details.status = 500.101;
        return cont;
      }
      try {
        if (top === par) {
          render_params = ParamHash(nm, null, null, true, true);
          cur_time = lang.time();
          guid = render_params.guid;
          guid_time = _cnum(guid.replace(/[^_]*_(\d+)_\d+_\d+/g, "$1"), 0);
          time_delta = cur_time - guid_time;
          cont = guid && guid_time && time_delta > 0 && time_delta < GUID_VALID_TIME;
          if (render_params.loc) {
            render_params.loc = unescape(render_params.loc);
          }
          if (!cont) {
            details.status = 500.104;
          }
        } else {
          details.status = 500.102;
        }
      } catch (_error) {
        e = _error;
        render_params = guid = null;
        cont = false;
        details.status = 500.103;
      }
      if (cont) {
        try {
          render_conf = render_params.conf;
          frame_id = win.name = render_conf.dest;
          pos_id = render_conf.id;
          pos_meta = render_params.meta;
          host_cname = render_params.host;
          geom_info = render_params.geom;
          can_use_html5 = lang.cbool(render_params.html5);
          win_has_focus = lang.cbool(render_params.has_focus);
          temp = render_conf.bg;
          if (geom_info) {
            geom_info = ParamHash(_ue(geom_info), null, null, true, true);
            if (!geom_info.self || !geom_info.exp) {
              geom_info = null;
            }
          }
          if (!host_cname) {
            host_cname = d.referrer;
            host_cname = host_cname.substring(0, host_cname.indexOf("/", 9));
          }
          if (temp) {
            _create_stylesheet(_cstr(["#sf_body { background-color: ", temp, "; }"]), "sf_bg_css");
          }
          temp = render_conf.tgt;
          if (temp === "_self") {
            render_conf.tgt = "_top";
          }
          if (!temp) {
            render_conf.tgt = "_top";
          }
          if (temp !== "_top") {
            while (_purge(_tags("base")[0])) {
              true;
            }
          }
          el = dom.make("base");
          _attr(el, "target", temp);
          _append(_tags("head")[0], el);
          if (isIE) {
            ie_old_attach = win[IE_ATTACH];
            ie_old_detach = win[IE_DETACH];
          }
          w3c_old_attach = win[W3C_ATTACH];
          w3c_old_detach = win[W3C_DETACH];
          _attach(win, UNLOAD, _handle_unload);
          _attach(win, LOAD, _handle_load);
          _attach(win, MSG, _handle_msg);
          _setup_win_evt_props(win);
          _setup_win_evt_props(win.__proto__);
          _setup_win_evt_props(win.Window && win.Window.prototype);
        } catch (_error) {
          e = _error;
          details.status = 500.105;
          render_params = render_conf = guid = null;
          ret = false;
        }
      } else {
        render_params = guid = null;
        ret = false;
      }
      return ret;
    };

    /*
    Render the HTML and CSS content passed in through the window.name message via a document.write
    
    @name $sf.ext-_render
    @function
    @static
    @private
     */
    _render = function() {
      var css, e, html;
      html = void 0;
      css = void 0;
      css = _cstr(render_conf && render_conf.css);
      html = _cstr(render_params && render_params.html);
      if (css) {
        css = _ue(css);
        _create_stylesheet(css, "sf_custom_css");
      }
      if (html) {
        html = _ue(html);
        try {
          d.write(html);
          _check_orphaned();
          _reset_inline_handlers();
        } catch (_error) {
          e = _error;
          _handle_err("Error while rendering content: " + e[MSG]);
        }
      }
    };

    /*
    Call into the fallback x-msging library client if possible when no HTML5 style messaging
    exists
    
    @name $sf.ext-_call_client_fb
    @function
    @private
    @static
    @param {String} methName The name of the message in the library to call
    @param {*} [arg1] An arbitrary argument to hand into the library
    @param {*} [arg2] An arbitrary argument to hand into the library
     */
    _call_client_fb = function(methName, arg1, arg2) {
      var msg_clientfb;
      if (msgclient_fb) {
        msg_clientfb = dom.msgclient_fb;
      }
      return methName && msgclient_fb && msgclient_fb[methName] && msgclient_fb[methName](arg1, arg2);
    };

    /*
    Process a validated message to notify the contents of the SafeFrame of state updates
    
    @name $sf.ext-_receive_msg
    @function
    @private
    @static
    @param {$sf.lib.lang.ParamHash} params The message parameter hash object containing information about what has occured
    @param {HTMLEvent} [evt] The raw DOM event from the x-domain message
    @return {Boolean} Whether or not the message received could be handled
     */
    _receive_msg = function(params, evt) {
      var cmd, data, e, force_collapse, g, geom_info, is_expanded, msg, pending_msg, ret, win_has_focus;
      ret = false;
      msg = void 0;
      cmd = void 0;
      g = void 0;
      e = void 0;
      data = {};
      if (params) {
        g = params.geom || "";
        cmd = params.cmd;
        if (g) {
          geom_info = ParamHash(_ue(g), null, null, true, true);
        }
      }
      data.cmd = cmd;
      data.value = data.info = params && params.value;
      data.reason = params && params.reason;
      if (cmd === NOTIFY_COLLAPSED) {
        ret = true;
        if (is_expanded) {
          pending_msg = null;
          is_expanded = false;
          force_collapse = true;
          _collapse();
          force_collapse = false;
          _fire_sandbox_callback(NOTIFY_COLLAPSED);
        }
      } else if (cmd === NOTIFY_COLLAPSE) {
        ret = true;
        if (is_expanded) {
          pending_msg = null;
          is_expanded = false;
          _fire_sandbox_callback(NOTIFY_COLLAPSED);
        }
      } else if (cmd === NOTIFY_EXPAND) {
        ret = true;
        if (pending_msg) {
          pending_msg = null;
          is_expanded = true;
          _fire_sandbox_callback(NOTIFY_EXPAND + "ed");
        }
      } else if (cmd === NOTIFY_GEOM_UPDATE) {
        _fire_sandbox_callback(NOTIFY_GEOM_UPDATE);
      } else if (cmd === NOTIFY_FOCUS_CHANGE) {
        data.info = data.value = lang.cbool(data.value);
        win_has_focus = data.value;
        _fire_sandbox_callback(NOTIFY_FOCUS_CHANGE, data);
      } else if (cmd === NOTIFY_READ_COOKIE) {
        ret = true;
        if (pending_msg) {
          pending_msg = null;
          is_expanded = true;
          data = params && params.value;
          _fire_sandbox_callback(NOTIFY_READ_COOKIE, data);
        }
      } else if (cmd === NOTIFY_WRITE_COOKIE) {
        ret = true;
        if (pending_msg) {
          pending_msg = null;
          is_expanded = true;
          _fire_sandbox_callback(NOTIFY_WRITE_COOKIE, data);
        }
      } else if (cmd === NOTIFY_FAILURE) {
        ret = true;
        if (pending_msg) {
          pending_msg = null;
          is_expanded = true;
          _fire_sandbox_callback(NOTIFY_FAILURE, data);
        }
      }
      params = null;
      return ret;
    };

    /*
    Send a command message up to the SafeFrames publisher / host code
    
    @name $sf.ext-_send_msg
    @private
    @function
    @static
    @param {String} str An encoded string (query-string/$sf.lib.lang.ParamHash format) that contains the command message to send
    @param {String} cmd The command to be sent itself (note that this string should also be present in the 1st argument)
     */
    _send_msg = function(str, cmd) {
      var e, frame_id, id, params, pending_msg, sent, sent_time;
      id = lang.guid("sf_pnd_cmd");
      frame_id = render_params.dest;
      sent = false;
      sent_time = lang.time();
      params = void 0;
      if (!str || !cmd || pending_msg) {
        return;
      }
      params = ParamHash({
        msg: str,
        id: frame_id,
        guid: guid,
        cmd: cmd
      });
      pending_msg = {
        id: id,
        sent: sent_time,
        cmd: cmd
      };
      setTimeout((function() {
        var force_collapse;
        if (pending_msg && pending_msg.id === id) {
          if (cmd === EXPAND_COMMAND || cmd === "exp-push") {
            force_collapse = true;
            _collapse();
            force_collapse = false;
          }
          _fire_sandbox_callback(NOTIFY_FAILURE + ":" + cmd + ":timeout");
        }
        id = sent = sent_time = cmd = str = pending_msg = params = null;
      }), MAX_MSG_WAIT_TIME);
      if (can_use_html5) {
        try {
          top.postMessage(params.toString(), (host_cname === "file" || host_cname === "" ? "*" : host_cname));
          sent = true;
        } catch (_error) {
          e = _error;
          sent = false;
        }
      }
      if (!sent) {
        _call_client_fb("send", params);
      }
    };

    /*
    Fire a notification off to the SafeFrame contents if a callback function was specified
    
    @name $sf.ext-_fire_sandbox_callback
    @private
    @function
    @static
    @param {String} msg The status update / message to send
    @param {Object} data The data from the response
     */
    _fire_sandbox_callback = function(msg, data) {
      var e;
      e = void 0;
      try {
        sandbox_cb(msg, data);
      } catch (_error) {}
    };

    /*
    Set the alignment of our internal DIV whenever expansion occurs uni-directionaly
    
    @name $sf.ext-_set_alignment
    @private
    @function
    @static
    @param {Boolean} xn Whether or not horizontal axis is growing to the left or right (xn == true == left)
    @param {Boolean} yn Whether or not vertical axis is growing to the top or bottom (yn == true == top)
     */
    _set_alignment = function(xn, yn) {
      var fcDiv, fcDivStyle, preTxt, xTxt, yTxt;
      fcDiv = _elt("sf_align");
      fcDivStyle = fcDiv.style;
      xTxt = void 0;
      yTxt = void 0;
      preTxt = "position:absolute;";
      if (xn) {
        xTxt = "right:0px;";
      } else {
        xTxt = "left:0px;";
      }
      if (yn) {
        yTxt = "bottom:0px;";
      } else {
        yTxt = "top:0px;";
      }
      fcDivStyle.cssText = preTxt + xTxt + yTxt;
      fcDiv = fcDivStyle = null;
    };

    /*
    Internal function for collapsing the SafeFrame, which checks that there is
    not some other pending state which may get in the way
    
    @name $sf.ext._collapse
    @private
    @function
    @static
     */
    _collapse = function() {
      if (!force_collapse && (!is_registered || !is_expanded || pending_msg)) {
        return false;
      }
      _set_alignment(0, 0);
      return true;
    };

    /*
    Intialize the SafeFrame external vendor/client API, so that other features may be used
    This method MUST be called prior to using any other rich-media functionality (like expansion).
    
    @name $sf.ext.register
    @public
    @function
    @static
    @param {Number} initWidth The initial width (in pixels) expected of the content within the SafeFrame container
    @param {Number} initHeight The initial height (in pixels) expected of the content within the SafeFrame container
    @param {Function} [notify] A callback function that content can specify to be notified of status updates
     */
    register = function(initWidth, initHeight, notify) {
      var init_height, init_width, is_registered, sandbox_cb;
      if (is_registered || !guid) {
        return;
      }
      initWidth = _cnum(initWidth, 0, 0);
      initHeight = _cnum(initHeight, 0, 0);
      init_width = initWidth;
      init_height = initHeight;
      is_registered = true;
      if (lang.callable(notify)) {
        sandbox_cb = notify;
      } else {
        sandbox_cb = null;
      }
    };

    /*
    Make a request to expand the SafeFrame container to a certain size. Note that you may only call $sf.ext.expand
    to expand to the largest size needed, followed by calling collapse (and then repeat the same process if needed).
    Tweening or animation done, should be reserved for your own content, and you cannot make multiple calls to expand
    without a corresponding collapse.
    
    Note that when setting t, l, b, and r offset values, expansion will not cause the content inside the SafeFrame
    to hold it's current alignment, whereas using dx/dy or only setting partial offfsets (e.g {t:100,l:100} ==  dx:-100,dy:-100) will cause expansion to
    hold it's current alignment.
    
    @name $sf.ext.expand
    @public
    @static
    @function
    @param {Number|Object} deltaXorDesc If a number is specifed, SafeFrame will grow in size by this amount in pixels along the horizontal axis. Specifiy a negative value to grow to the left, and a postive value to grow to the right. <br />
    If an object is specified, it should contain "t","l","r","b" properties (top,left,bottom,right) for the amount in pixels to grow the container in each dimension
    @param {Number} deltaXorDesc.t Specifies to shift the top position of the SafeFrame container by the number of pixels specified, relative to original location (negative values not allowed).
    @param {Number} deltaXorDesc.l Specifies to shift the left position of the SafeFrame container by the number of pixels specified, relative to original location (negative values not allowed).
    @param {Number} deltaXorDesc.b Specifies to shift the bottom position of the SafeFrame container by the number of pixels specified, relative to the original location (negative values not allowed).
    @param {Number} deltaXorDesc.r Specifies to shift the left position of the SafeFrame container by the number of pixels specified, relative to the original location (negative values not allowed).
    @param {Boolean}deltaXorDesc.push  When expanding, push other page content rather than doing an overlay.  Note that setting this value to true will only work if the publisher / host explicitly allows push expansion
    Check $sf.ext.supports("exp-push"), ahead of time to verify
    
    @param {Number} deltaY If a number is specifed, SafeFrame will grow in size by this amount in pixels along the vertical axis. Specifiy a negative value to grow to the top, and a postive value to grow to the bottom. <br />
    Note that this value is ignored if deltaXorDesc is passed in as an object.
    
    @param {Boolean} push When expanding, push other page content rather than doing an overlay.  Note that setting this value to true will only work if the publisher / host explicitly allows push expansion
    Check $sf.ext.supports("exp-push"), ahead of time to verify
    
    
    @return {Boolean} true/false if the request to expand the container was sent. This does not mean that expansion is complete as expansion is an asynchronous process. Pass in a callback function to $sf.ext.register to get status updates.
     */
    expand = function(deltaXorDesc, deltaY, p) {
      var align_buffer, align_el, align_el_st, b, cmd_nm, cmd_str, doAlign, dx, dy, l, r, t, xn, yn;
      xn = false;
      yn = false;
      doAlign = false;
      cmd_nm = (p ? "exp-push" : EXPAND_COMMAND);
      cmd_str = ["cmd=", cmd_nm, "&pos=", pos_id];
      dx = 0;
      dy = 0;
      r = void 0;
      b = void 0;
      t = void 0;
      l = void 0;
      align_el = void 0;
      align_el_st = void 0;
      align_buffer = void 0;
      if (!is_registered || pending_msg) {
        return;
      }
      if (p && !supports("exp-push")) {
        return;
      }
      if (deltaXorDesc && typeof deltaXorDesc === OBJ) {
        r = _cnum(deltaXorDesc.r, 0, 0);
        b = _cnum(deltaXorDesc.b, 0, 0);
        t = _cnum(deltaXorDesc.t, 0, 0);
        l = _cnum(deltaXorDesc.l, 0, 0);
        if (deltaXorDesc.push) {
          if (!supports("exp-push")) {
            return;
          }
          cmd_nm = "exp-push";
          cmd_str[1] = cmd_nm;
        }
        if (!r && l) {
          xn = true;
          dx = -1 * l;
        }
        if (r && !l) {
          dx = r;
        }
        if (!b && t) {
          yn = true;
          dy = -1 * t;
        }
        if (b && !t) {
          dy = b;
        }
        if ((t && b) || (l && r)) {
          doAlign = false;
        } else {
          doAlign = true;
        }
        if (doAlign) {
          _set_alignment(xn, yn);
          cmd_str.push("&dx=", dx, "&dy=", dy);
          _send_msg(_cstr(cmd_str), cmd_nm);
        } else {
          align_el = _elt("sf_align");
          align_el_st = align_el && align_el.style;
          align_buffer = ["position:absolute;"];
          if (t && b) {
            align_buffer.push("top:", t, "px;");
          } else if (t) {
            align_buffer.push("bottom:0px;");
          } else {
            if (b) {
              align_buffer.push("top:0px;");
            }
          }
          if (l && r) {
            align_buffer.push("left:", l, "px;");
          } else if (l) {
            align_buffer.push("right:0px;");
          } else {
            if (b) {
              align_buffer.push("left:0px;");
            }
          }
          if (align_el_st) {
            align_el_st.cssText = _cstr(align_buffer);
          }
          cmd_str.push("&exp_obj=", escape(ParamHash(deltaXorDesc)));
          _send_msg(_cstr(cmd_str), cmd_nm);
        }
      } else {
        deltaXorDesc = _cnum(deltaXorDesc, 0);
        deltaY = _cnum(deltaY, 0);
        if (deltaXorDesc <= 0 && deltaY <= 0) {
          return;
        }
        xn = deltaXorDesc <= 0;
        yn = deltaY <= 0;
        _set_alignment(xn, yn);
        cmd_str.push("&dx=", deltaXorDesc, "&dy=", deltaY);
        _send_msg(_cstr(cmd_str), cmd_nm);
      }
      return true;
    };

    /*
    Collapse the SafeFrame container after having called to expand. If no previous call to expand has been made, this call will do nothing.
    
    @name $sf.ext.collapse
    @public
    @static
    @function
     */
    collapse = function() {
      if (_collapse()) {
        _send_msg(_cstr(["cmd=", COLLAPSE_COMMAND, "&pos=", pos_id]), COLLAPSE_COMMAND);
      }
    };

    /*
    Return geometric information about the SafeFrame container and it's status within a page
    
    @name $sf.ext.geom
    @public
    @static
    @function
    @return {Object} geom_info
     */
    geom = function() {
      return geom_info;
    };

    /*
    Return meta-data information that may have been specified by the publisher / host.
    
    @name $sf.ext.meta
    @public
    @static
    @function
    @param {String} propName the key name of the meta-data value to be retrieved
    @param {String} [owner_key] the super key name of the data to be retrieved
    @return {String} The value of some meta-data that may have been specified by the publisher / host or "".
     */
    meta = function(propName, owner_key) {
      var ret, shared;
      ret = "";
      shared = void 0;
      if (pos_meta) {
        if (owner_key) {
          if (owner_key in pos_meta) {
            ret = _cstr(pos_meta[owner_key][propName]);
          } else {
            if (pos_meta.non_shared && owner_key in pos_meta.non_shared) {
              ret = _cstr(pos_meta.non_shared[owner_key][propName]);
            }
          }
        } else {
          shared = pos_meta.shared;
          if (shared && typeof shared === OBJ) {
            ret = _cstr(shared[propName]);
          }
        }
      }
      return ret;
    };

    /*
    Return the current status of the SafeFrame container, in cases where
    a command may be pending. If an empty string is returned ("") container is idle.
    
    @name $sf.ext.status
    @public
    @static
    @function
    @return {String} of any pending status, otherwise empty string.
     */
    status = function() {
      if (pending_msg) {
        if (pending_msg.cmd === EXPAND_COMMAND) {
          return STATUS_EXPANDING;
        } else {
          if (pending_msg.cmd === COLLAPSE_COMMAND) {
            return STATUS;
          }
        }
      }
      if (is_expanded) {
        return STATUS_EXPANDED;
      } else {
        return STATUS_COLLAPSED;
      }
    };

    /*
    Requests the host read or write a cookie to the host domain.
    The host domain must grant permission for the cookie to be written.
    
    @name $sf.ext.cookie
    @public
    @static
    @function
    @param {String} [cookieName] The name of the cookie to set or read
    @param {Object} [cookieData] An object hash containing the value and an optional expires
    @return {Number}
     */
    cookie = function(cookieName, cookieData) {
      var cmd_nm, cmd_str, isRead;
      isRead = !(cookieData != null);
      cmd_nm = (isRead ? "read-cookie" : "write-cookie");
      cmd_str = ["cmd=", cmd_nm, "&pos=", pos_id, "&cookie=", cookieName];
      if (!isRead) {
        cmd_str.push("&value=");
        cmd_str.push(cookieData.value);
      }
      _send_msg(_cstr(cmd_str), cmd_nm);
    };

    /*
    Send a message to the host
    
    @name $sf.ext.message
    @public
    @static
    @function
     */
    message = function(content) {
      _send_msg(_cstr(["cmd=", "msg", "&pos=", pos_id, "&msg=", content]), "msg");
    };

    /*
    Return the percentage that the SafeFrame container is viewable within the browser window
    
    @name $sf.ext.inViewPercentage
    @public
    @static
    @function
    @return {Number}
     */
    inViewPercentage = function() {
      var iv, tv;
      iv = _cnum(geom_info && geom_info.self && geom_info.self.iv, -1, 0);
      tv = void 0;
      if (iv >= 0) {
        tv = Math.floor(iv * 100);
      }
      return tv;
    };
    winHasFocus = function() {
      return win_has_focus;
    };

    /*
    Return whether or not a particular feature is supported, or an object containing
    key/value pairs denoting all features and whether or not they are supported
    
    By default SafeFrames version 1 supports the following feature:
    
    "exp-ovr": Expansion of the container by overlaying on top of other content
    
    Later in other versions there are expexted to be more feature with their own
    string name, that can be checked by the content in the SafeFrame, so that
    it knows what things can be done.
    
    @name $sf.ext.supports
    @public
    @static
    @function
    @param {String} [key] If specifed, checks to see if that specific feature has been enabled
    @return {Boolean|Object}
     */
    supports = function(key) {
      var conf, sup;
      conf = render_params.conf;
      sup = (conf && conf.supports) || false;
      if (sup) {
        key = _cstr(key);
        if (key) {
          sup = sup[key] || false;
          if (sup === "0") {
            sup = false;
          }
        } else {
          sup = lang.mix({}, sup);
        }
      }
      return sup;
    };
    LOAD = "load";
    ON_STR = "on";
    MSG = "message";
    UNLOAD = "un" + LOAD;
    ONUNLOAD = ON_STR + UNLOAD;
    ONMSG = ON_STR + MSG;
    ONLOAD = ON_STR + LOAD;
    DG = "__defineGetter__";
    DS = "__defineSetter__";
    DP = "__defineProperty__";
    W3C_ATTACH = "addEventListener";
    W3C_DETACH = "removeEventListener";
    IE_ATTACH = "attachEvent";
    IE_DETACH = "detachEvent";
    TOLOWERCASE = "toLowerCase";
    EXPAND_COMMAND = "exp-ovr";
    COLLAPSE_COMMAND = "collapse";
    ERROR_COMMAND = "error";
    NOTIFY_GEOM_UPDATE = "geom-update";
    NOTIFY_EXPAND = "expand";
    NOTIFY_FOCUS_CHANGE = "focus-change";
    NOTIFY_COLLAPSE = COLLAPSE_COMMAND;
    NOTIFY_COLLAPSED = NOTIFY_COLLAPSE + "d";
    NOTIFY_FAILURE = "failed";
    NOTIFY_READ_COOKIE = "read-cookie";
    NOTIFY_WRITE_COOKIE = "write-cookie";
    STATUS_COLLAPSED = NOTIFY_COLLAPSED;
    STATUS_EXPANDED = NOTIFY_EXPAND + "ed";
    STATUS_COLLAPSING = "collapsing";
    STATUS_EXPANDING = NOTIFY_EXPAND + "ing";
    OUR_TAG_CLS_NAME = "sf";
    MAX_MSG_WAIT_TIME = 4000;
    DOM_WATCH_INTERVAL = 3000;
    GUID_VALID_TIME = 30000;
    OBJ = "object";
    d = win && win.document;
    par = win && win.parent;
    lib = sf.lib;
    env = sf.env;
    lang = lib.lang;
    ParamHash = lang.ParamHash;
    dom = lib.dom;
    iframes = dom.iframes;
    msgclient_fb = dom.msgclient_fb;
    isIE = env.isIE;
    _ue = win.unescape;
    _cstr = lang.cstr;
    _cnum = lang.cnum;
    _append = dom.append;
    _tags = dom.tags;
    _elt = dom && dom.elt;
    _purge = dom && dom.purge;
    _attach = dom && dom.attach;
    _detach = dom && dom.detach;
    _attr = dom && dom.attr;
    loaded = false;
    is_expanded = false;
    force_collapse = false;
    is_registered = false;
    init_width = 0;
    init_height = 0;
    sandbox_cb = null;
    pending_msg = null;
    geom_info = null;
    pos_meta = null;
    win_has_focus = false;
    guid = "";
    host_cname = "";
    can_use_html5 = false;
    frame_id = "";
    pos_id = "";
    err_msg_timer_id = 0;
    orphan_timer_id = 0;
    inline_handler_timer_id = 0;
    err_msgs = [];
    unload_handlers = [];
    render_params = void 0;
    render_conf = void 0;
    ie_old_attach = void 0;
    w3c_old_attach = void 0;
    ie_old_detach = void 0;
    w3c_old_detach = void 0;
    return (function() {
      var err_info;
      err_info = {};
      if (_construction(err_info)) {
        lang.ext = {
          register: register,
          expand: expand,
          collapse: collapse,
          geom: geom,
          meta: meta,
          status: status,
          supports: supports,
          cookie: cookie,
          message: message,
          inViewPercentage: inViewPercentage,
          winHasFocus: winHasFocus
        };
        _render();
      }
      return sf;
    })();
  });

}).call(this);

// Generated by CoffeeScript 1.7.1
(function() {
  require(["./ext/ext"], function(sf) {
    return window.$sf = sf;
  }, "sf.ext", true);

}).call(this);

define("ext", function(){});

}());