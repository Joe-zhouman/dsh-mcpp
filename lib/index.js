import z from "@deepseek-ai/schemastery";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Agent, createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { Agent as Agent$1, request as request$1 } from "node:https";
//#region node_modules/js-yaml/dist/js-yaml.mjs
function getDefaultExportFromCjs(x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var jsYaml = {};
var loader = {};
var common = {};
var hasRequiredCommon;
function requireCommon() {
	if (hasRequiredCommon) return common;
	hasRequiredCommon = 1;
	function isNothing(subject) {
		return typeof subject === "undefined" || subject === null;
	}
	function isObject(subject) {
		return typeof subject === "object" && subject !== null;
	}
	function toArray(sequence) {
		if (Array.isArray(sequence)) return sequence;
		else if (isNothing(sequence)) return [];
		return [sequence];
	}
	function extend(target, source) {
		if (source) {
			const sourceKeys = Object.keys(source);
			for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
				const key = sourceKeys[index];
				target[key] = source[key];
			}
		}
		return target;
	}
	function repeat(string, count) {
		let result = "";
		for (let cycle = 0; cycle < count; cycle += 1) result += string;
		return result;
	}
	function isNegativeZero(number) {
		return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
	}
	common.isNothing = isNothing;
	common.isObject = isObject;
	common.toArray = toArray;
	common.repeat = repeat;
	common.isNegativeZero = isNegativeZero;
	common.extend = extend;
	return common;
}
var exception;
var hasRequiredException;
function requireException() {
	if (hasRequiredException) return exception;
	hasRequiredException = 1;
	function formatError(exception2, compact) {
		let where = "";
		const message = exception2.reason || "(unknown reason)";
		if (!exception2.mark) return message;
		if (exception2.mark.name) where += "in \"" + exception2.mark.name + "\" ";
		where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
		if (!compact && exception2.mark.snippet) where += "\n\n" + exception2.mark.snippet;
		return message + " " + where;
	}
	function YAMLException2(reason, mark) {
		Error.call(this);
		this.name = "YAMLException";
		this.reason = reason;
		this.mark = mark;
		this.message = formatError(this, false);
		if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
		else this.stack = (/* @__PURE__ */ new Error()).stack || "";
	}
	YAMLException2.prototype = Object.create(Error.prototype);
	YAMLException2.prototype.constructor = YAMLException2;
	YAMLException2.prototype.toString = function toString(compact) {
		return this.name + ": " + formatError(this, compact);
	};
	exception = YAMLException2;
	return exception;
}
var snippet;
var hasRequiredSnippet;
function requireSnippet() {
	if (hasRequiredSnippet) return snippet;
	hasRequiredSnippet = 1;
	const common2 = requireCommon();
	function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
		let head = "";
		let tail = "";
		const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
		if (position - lineStart > maxHalfLength) {
			head = " ... ";
			lineStart = position - maxHalfLength + head.length;
		}
		if (lineEnd - position > maxHalfLength) {
			tail = " ...";
			lineEnd = position + maxHalfLength - tail.length;
		}
		return {
			str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
			pos: position - lineStart + head.length
		};
	}
	function padStart(string, max) {
		return common2.repeat(" ", max - string.length) + string;
	}
	function makeSnippet(mark, options) {
		options = Object.create(options || null);
		if (!mark.buffer) return null;
		if (!options.maxLength) options.maxLength = 79;
		if (typeof options.indent !== "number") options.indent = 1;
		if (typeof options.linesBefore !== "number") options.linesBefore = 3;
		if (typeof options.linesAfter !== "number") options.linesAfter = 2;
		const re = /\r?\n|\r|\0/g;
		const lineStarts = [0];
		const lineEnds = [];
		let match;
		let foundLineNo = -1;
		while (match = re.exec(mark.buffer)) {
			lineEnds.push(match.index);
			lineStarts.push(match.index + match[0].length);
			if (mark.position <= match.index && foundLineNo < 0) foundLineNo = lineStarts.length - 2;
		}
		if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
		let result = "";
		const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
		const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
		for (let i = 1; i <= options.linesBefore; i++) {
			if (foundLineNo - i < 0) break;
			const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
			result = common2.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
		}
		const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
		result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
		result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
		for (let i = 1; i <= options.linesAfter; i++) {
			if (foundLineNo + i >= lineEnds.length) break;
			const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
			result += common2.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
		}
		return result.replace(/\n$/, "");
	}
	snippet = makeSnippet;
	return snippet;
}
var type;
var hasRequiredType;
function requireType() {
	if (hasRequiredType) return type;
	hasRequiredType = 1;
	const YAMLException2 = requireException();
	const TYPE_CONSTRUCTOR_OPTIONS = [
		"kind",
		"multi",
		"resolve",
		"construct",
		"instanceOf",
		"predicate",
		"represent",
		"representName",
		"defaultStyle",
		"styleAliases"
	];
	const YAML_NODE_KINDS = [
		"scalar",
		"sequence",
		"mapping"
	];
	function compileStyleAliases(map2) {
		const result = {};
		if (map2 !== null) Object.keys(map2).forEach(function(style) {
			map2[style].forEach(function(alias) {
				result[String(alias)] = style;
			});
		});
		return result;
	}
	function Type2(tag, options) {
		options = options || {};
		Object.keys(options).forEach(function(name) {
			if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) throw new YAMLException2("Unknown option \"" + name + "\" is met in definition of \"" + tag + "\" YAML type.");
		});
		this.options = options;
		this.tag = tag;
		this.kind = options["kind"] || null;
		this.resolve = options["resolve"] || function() {
			return true;
		};
		this.construct = options["construct"] || function(data) {
			return data;
		};
		this.instanceOf = options["instanceOf"] || null;
		this.predicate = options["predicate"] || null;
		this.represent = options["represent"] || null;
		this.representName = options["representName"] || null;
		this.defaultStyle = options["defaultStyle"] || null;
		this.multi = options["multi"] || false;
		this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
		if (YAML_NODE_KINDS.indexOf(this.kind) === -1) throw new YAMLException2("Unknown kind \"" + this.kind + "\" is specified for \"" + tag + "\" YAML type.");
	}
	type = Type2;
	return type;
}
var schema;
var hasRequiredSchema;
function requireSchema() {
	if (hasRequiredSchema) return schema;
	hasRequiredSchema = 1;
	const YAMLException2 = requireException();
	const Type2 = requireType();
	function compileList(schema2, name) {
		const result = [];
		schema2[name].forEach(function(currentType) {
			let newIndex = result.length;
			result.forEach(function(previousType, previousIndex) {
				if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) newIndex = previousIndex;
			});
			result[newIndex] = currentType;
		});
		return result;
	}
	function compileMap() {
		const result = {
			scalar: {},
			sequence: {},
			mapping: {},
			fallback: {},
			multi: {
				scalar: [],
				sequence: [],
				mapping: [],
				fallback: []
			}
		};
		function collectType(type2) {
			if (type2.multi) {
				result.multi[type2.kind].push(type2);
				result.multi["fallback"].push(type2);
			} else result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
		}
		for (let index = 0, length = arguments.length; index < length; index += 1) arguments[index].forEach(collectType);
		return result;
	}
	function Schema2(definition) {
		return this.extend(definition);
	}
	Schema2.prototype.extend = function extend(definition) {
		let implicit = [];
		let explicit = [];
		if (definition instanceof Type2) explicit.push(definition);
		else if (Array.isArray(definition)) explicit = explicit.concat(definition);
		else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
			if (definition.implicit) implicit = implicit.concat(definition.implicit);
			if (definition.explicit) explicit = explicit.concat(definition.explicit);
		} else throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
		implicit.forEach(function(type2) {
			if (!(type2 instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
			if (type2.loadKind && type2.loadKind !== "scalar") throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
			if (type2.multi) throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
		});
		explicit.forEach(function(type2) {
			if (!(type2 instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
		});
		const result = Object.create(Schema2.prototype);
		result.implicit = (this.implicit || []).concat(implicit);
		result.explicit = (this.explicit || []).concat(explicit);
		result.compiledImplicit = compileList(result, "implicit");
		result.compiledExplicit = compileList(result, "explicit");
		result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
		return result;
	};
	schema = Schema2;
	return schema;
}
var str;
var hasRequiredStr;
function requireStr() {
	if (hasRequiredStr) return str;
	hasRequiredStr = 1;
	str = new (requireType())("tag:yaml.org,2002:str", {
		kind: "scalar",
		construct: function(data) {
			return data !== null ? data : "";
		}
	});
	return str;
}
var seq;
var hasRequiredSeq;
function requireSeq() {
	if (hasRequiredSeq) return seq;
	hasRequiredSeq = 1;
	seq = new (requireType())("tag:yaml.org,2002:seq", {
		kind: "sequence",
		construct: function(data) {
			return data !== null ? data : [];
		}
	});
	return seq;
}
var map;
var hasRequiredMap;
function requireMap() {
	if (hasRequiredMap) return map;
	hasRequiredMap = 1;
	map = new (requireType())("tag:yaml.org,2002:map", {
		kind: "mapping",
		construct: function(data) {
			return data !== null ? data : {};
		}
	});
	return map;
}
var failsafe;
var hasRequiredFailsafe;
function requireFailsafe() {
	if (hasRequiredFailsafe) return failsafe;
	hasRequiredFailsafe = 1;
	failsafe = new (requireSchema())({ explicit: [
		requireStr(),
		requireSeq(),
		requireMap()
	] });
	return failsafe;
}
var _null;
var hasRequired_null;
function require_null() {
	if (hasRequired_null) return _null;
	hasRequired_null = 1;
	const Type2 = requireType();
	function resolveYamlNull(data) {
		if (data === null) return true;
		const max = data.length;
		return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
	}
	function constructYamlNull() {
		return null;
	}
	function isNull(object) {
		return object === null;
	}
	_null = new Type2("tag:yaml.org,2002:null", {
		kind: "scalar",
		resolve: resolveYamlNull,
		construct: constructYamlNull,
		predicate: isNull,
		represent: {
			canonical: function() {
				return "~";
			},
			lowercase: function() {
				return "null";
			},
			uppercase: function() {
				return "NULL";
			},
			camelcase: function() {
				return "Null";
			},
			empty: function() {
				return "";
			}
		},
		defaultStyle: "lowercase"
	});
	return _null;
}
var bool;
var hasRequiredBool;
function requireBool() {
	if (hasRequiredBool) return bool;
	hasRequiredBool = 1;
	const Type2 = requireType();
	function resolveYamlBoolean(data) {
		if (data === null) return false;
		const max = data.length;
		return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
	}
	function constructYamlBoolean(data) {
		return data === "true" || data === "True" || data === "TRUE";
	}
	function isBoolean(object) {
		return Object.prototype.toString.call(object) === "[object Boolean]";
	}
	bool = new Type2("tag:yaml.org,2002:bool", {
		kind: "scalar",
		resolve: resolveYamlBoolean,
		construct: constructYamlBoolean,
		predicate: isBoolean,
		represent: {
			lowercase: function(object) {
				return object ? "true" : "false";
			},
			uppercase: function(object) {
				return object ? "TRUE" : "FALSE";
			},
			camelcase: function(object) {
				return object ? "True" : "False";
			}
		},
		defaultStyle: "lowercase"
	});
	return bool;
}
var int;
var hasRequiredInt;
function requireInt() {
	if (hasRequiredInt) return int;
	hasRequiredInt = 1;
	const common2 = requireCommon();
	const Type2 = requireType();
	function isHexCode(c) {
		return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
	}
	function isOctCode(c) {
		return c >= 48 && c <= 55;
	}
	function isDecCode(c) {
		return c >= 48 && c <= 57;
	}
	function resolveYamlInteger(data) {
		if (data === null) return false;
		const max = data.length;
		let index = 0;
		let hasDigits = false;
		if (!max) return false;
		let ch = data[index];
		if (ch === "-" || ch === "+") ch = data[++index];
		if (ch === "0") {
			if (index + 1 === max) return true;
			ch = data[++index];
			if (ch === "b") {
				index++;
				for (; index < max; index++) {
					ch = data[index];
					if (ch !== "0" && ch !== "1") return false;
					hasDigits = true;
				}
				return hasDigits && isFinite(parseYamlInteger(data));
			}
			if (ch === "x") {
				index++;
				for (; index < max; index++) {
					if (!isHexCode(data.charCodeAt(index))) return false;
					hasDigits = true;
				}
				return hasDigits && isFinite(parseYamlInteger(data));
			}
			if (ch === "o") {
				index++;
				for (; index < max; index++) {
					if (!isOctCode(data.charCodeAt(index))) return false;
					hasDigits = true;
				}
				return hasDigits && isFinite(parseYamlInteger(data));
			}
		}
		for (; index < max; index++) {
			if (!isDecCode(data.charCodeAt(index))) return false;
			hasDigits = true;
		}
		if (!hasDigits) return false;
		return isFinite(parseYamlInteger(data));
	}
	function parseYamlInteger(data) {
		let value = data;
		let sign = 1;
		let ch = value[0];
		if (ch === "-" || ch === "+") {
			if (ch === "-") sign = -1;
			value = value.slice(1);
			ch = value[0];
		}
		if (value === "0") return 0;
		if (ch === "0") {
			if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
			if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
			if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
		}
		return sign * parseInt(value, 10);
	}
	function constructYamlInteger(data) {
		return parseYamlInteger(data);
	}
	function isInteger(object) {
		return Object.prototype.toString.call(object) === "[object Number]" && object % 1 === 0 && !common2.isNegativeZero(object);
	}
	int = new Type2("tag:yaml.org,2002:int", {
		kind: "scalar",
		resolve: resolveYamlInteger,
		construct: constructYamlInteger,
		predicate: isInteger,
		represent: {
			binary: function(obj) {
				return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
			},
			octal: function(obj) {
				return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
			},
			decimal: function(obj) {
				return obj.toString(10);
			},
			hexadecimal: function(obj) {
				return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
			}
		},
		defaultStyle: "decimal",
		styleAliases: {
			binary: [2, "bin"],
			octal: [8, "oct"],
			decimal: [10, "dec"],
			hexadecimal: [16, "hex"]
		}
	});
	return int;
}
var float;
var hasRequiredFloat;
function requireFloat() {
	if (hasRequiredFloat) return float;
	hasRequiredFloat = 1;
	const common2 = requireCommon();
	const Type2 = requireType();
	const YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
	const YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
	function resolveYamlFloat(data) {
		if (data === null) return false;
		if (!YAML_FLOAT_PATTERN.test(data)) return false;
		if (isFinite(parseFloat(data, 10))) return true;
		return YAML_FLOAT_SPECIAL_PATTERN.test(data);
	}
	function constructYamlFloat(data) {
		let value = data.toLowerCase();
		const sign = value[0] === "-" ? -1 : 1;
		if ("+-".indexOf(value[0]) >= 0) value = value.slice(1);
		if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
		else if (value === ".nan") return NaN;
		return sign * parseFloat(value, 10);
	}
	const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
	function representYamlFloat(object, style) {
		if (isNaN(object)) switch (style) {
			case "lowercase": return ".nan";
			case "uppercase": return ".NAN";
			case "camelcase": return ".NaN";
		}
		else if (Number.POSITIVE_INFINITY === object) switch (style) {
			case "lowercase": return ".inf";
			case "uppercase": return ".INF";
			case "camelcase": return ".Inf";
		}
		else if (Number.NEGATIVE_INFINITY === object) switch (style) {
			case "lowercase": return "-.inf";
			case "uppercase": return "-.INF";
			case "camelcase": return "-.Inf";
		}
		else if (common2.isNegativeZero(object)) return "-0.0";
		const res = object.toString(10);
		return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
	}
	function isFloat(object) {
		return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
	}
	float = new Type2("tag:yaml.org,2002:float", {
		kind: "scalar",
		resolve: resolveYamlFloat,
		construct: constructYamlFloat,
		predicate: isFloat,
		represent: representYamlFloat,
		defaultStyle: "lowercase"
	});
	return float;
}
var json;
var hasRequiredJson;
function requireJson() {
	if (hasRequiredJson) return json;
	hasRequiredJson = 1;
	json = requireFailsafe().extend({ implicit: [
		require_null(),
		requireBool(),
		requireInt(),
		requireFloat()
	] });
	return json;
}
var core;
var hasRequiredCore;
function requireCore() {
	if (hasRequiredCore) return core;
	hasRequiredCore = 1;
	core = requireJson();
	return core;
}
var timestamp;
var hasRequiredTimestamp;
function requireTimestamp() {
	if (hasRequiredTimestamp) return timestamp;
	hasRequiredTimestamp = 1;
	const Type2 = requireType();
	const YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
	const YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
	function resolveYamlTimestamp(data) {
		if (data === null) return false;
		if (YAML_DATE_REGEXP.exec(data) !== null) return true;
		if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
		return false;
	}
	function constructYamlTimestamp(data) {
		let fraction = 0;
		let delta = null;
		let match = YAML_DATE_REGEXP.exec(data);
		if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
		if (match === null) throw new Error("Date resolve error");
		const year = +match[1];
		const month = +match[2] - 1;
		const day = +match[3];
		if (!match[4]) return new Date(Date.UTC(year, month, day));
		const hour = +match[4];
		const minute = +match[5];
		const second = +match[6];
		if (match[7]) {
			fraction = match[7].slice(0, 3);
			while (fraction.length < 3) fraction += "0";
			fraction = +fraction;
		}
		if (match[9]) {
			const tzHour = +match[10];
			const tzMinute = +(match[11] || 0);
			delta = (tzHour * 60 + tzMinute) * 6e4;
			if (match[9] === "-") delta = -delta;
		}
		const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
		if (delta) date.setTime(date.getTime() - delta);
		return date;
	}
	function representYamlTimestamp(object) {
		return object.toISOString();
	}
	timestamp = new Type2("tag:yaml.org,2002:timestamp", {
		kind: "scalar",
		resolve: resolveYamlTimestamp,
		construct: constructYamlTimestamp,
		instanceOf: Date,
		represent: representYamlTimestamp
	});
	return timestamp;
}
var merge;
var hasRequiredMerge;
function requireMerge() {
	if (hasRequiredMerge) return merge;
	hasRequiredMerge = 1;
	const Type2 = requireType();
	function resolveYamlMerge(data) {
		return data === "<<" || data === null;
	}
	merge = new Type2("tag:yaml.org,2002:merge", {
		kind: "scalar",
		resolve: resolveYamlMerge
	});
	return merge;
}
var binary;
var hasRequiredBinary;
function requireBinary() {
	if (hasRequiredBinary) return binary;
	hasRequiredBinary = 1;
	const Type2 = requireType();
	const BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
	function resolveYamlBinary(data) {
		if (data === null) return false;
		let bitlen = 0;
		const max = data.length;
		const map2 = BASE64_MAP;
		for (let idx = 0; idx < max; idx++) {
			const code = map2.indexOf(data.charAt(idx));
			if (code > 64) continue;
			if (code < 0) return false;
			bitlen += 6;
		}
		return bitlen % 8 === 0;
	}
	function constructYamlBinary(data) {
		const input = data.replace(/[\r\n=]/g, "");
		const max = input.length;
		const map2 = BASE64_MAP;
		let bits = 0;
		const result = [];
		for (let idx = 0; idx < max; idx++) {
			if (idx % 4 === 0 && idx) {
				result.push(bits >> 16 & 255);
				result.push(bits >> 8 & 255);
				result.push(bits & 255);
			}
			bits = bits << 6 | map2.indexOf(input.charAt(idx));
		}
		const tailbits = max % 4 * 6;
		if (tailbits === 0) {
			result.push(bits >> 16 & 255);
			result.push(bits >> 8 & 255);
			result.push(bits & 255);
		} else if (tailbits === 18) {
			result.push(bits >> 10 & 255);
			result.push(bits >> 2 & 255);
		} else if (tailbits === 12) result.push(bits >> 4 & 255);
		return new Uint8Array(result);
	}
	function representYamlBinary(object) {
		let result = "";
		let bits = 0;
		const max = object.length;
		const map2 = BASE64_MAP;
		for (let idx = 0; idx < max; idx++) {
			if (idx % 3 === 0 && idx) {
				result += map2[bits >> 18 & 63];
				result += map2[bits >> 12 & 63];
				result += map2[bits >> 6 & 63];
				result += map2[bits & 63];
			}
			bits = (bits << 8) + object[idx];
		}
		const tail = max % 3;
		if (tail === 0) {
			result += map2[bits >> 18 & 63];
			result += map2[bits >> 12 & 63];
			result += map2[bits >> 6 & 63];
			result += map2[bits & 63];
		} else if (tail === 2) {
			result += map2[bits >> 10 & 63];
			result += map2[bits >> 4 & 63];
			result += map2[bits << 2 & 63];
			result += map2[64];
		} else if (tail === 1) {
			result += map2[bits >> 2 & 63];
			result += map2[bits << 4 & 63];
			result += map2[64];
			result += map2[64];
		}
		return result;
	}
	function isBinary(obj) {
		return Object.prototype.toString.call(obj) === "[object Uint8Array]";
	}
	binary = new Type2("tag:yaml.org,2002:binary", {
		kind: "scalar",
		resolve: resolveYamlBinary,
		construct: constructYamlBinary,
		predicate: isBinary,
		represent: representYamlBinary
	});
	return binary;
}
var omap;
var hasRequiredOmap;
function requireOmap() {
	if (hasRequiredOmap) return omap;
	hasRequiredOmap = 1;
	const Type2 = requireType();
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	const _toString = Object.prototype.toString;
	function resolveYamlOmap(data) {
		if (data === null) return true;
		const objectKeys = {};
		const object = data;
		for (let index = 0, length = object.length; index < length; index += 1) {
			const pair = object[index];
			let pairHasKey = false;
			if (_toString.call(pair) !== "[object Object]") return false;
			let pairKey;
			for (pairKey in pair) if (_hasOwnProperty.call(pair, pairKey)) if (!pairHasKey) pairHasKey = true;
			else return false;
			if (!pairHasKey) return false;
			if (_hasOwnProperty.call(objectKeys, pairKey)) return false;
			Object.defineProperty(objectKeys, pairKey, { value: true });
		}
		return true;
	}
	function constructYamlOmap(data) {
		return data !== null ? data : [];
	}
	omap = new Type2("tag:yaml.org,2002:omap", {
		kind: "sequence",
		resolve: resolveYamlOmap,
		construct: constructYamlOmap
	});
	return omap;
}
var pairs;
var hasRequiredPairs;
function requirePairs() {
	if (hasRequiredPairs) return pairs;
	hasRequiredPairs = 1;
	const Type2 = requireType();
	const _toString = Object.prototype.toString;
	function resolveYamlPairs(data) {
		if (data === null) return true;
		const object = data;
		const result = new Array(object.length);
		for (let index = 0, length = object.length; index < length; index += 1) {
			const pair = object[index];
			if (_toString.call(pair) !== "[object Object]") return false;
			const keys = Object.keys(pair);
			if (keys.length !== 1) return false;
			result[index] = [keys[0], pair[keys[0]]];
		}
		return true;
	}
	function constructYamlPairs(data) {
		if (data === null) return [];
		const object = data;
		const result = new Array(object.length);
		for (let index = 0, length = object.length; index < length; index += 1) {
			const pair = object[index];
			const keys = Object.keys(pair);
			result[index] = [keys[0], pair[keys[0]]];
		}
		return result;
	}
	pairs = new Type2("tag:yaml.org,2002:pairs", {
		kind: "sequence",
		resolve: resolveYamlPairs,
		construct: constructYamlPairs
	});
	return pairs;
}
var set;
var hasRequiredSet;
function requireSet() {
	if (hasRequiredSet) return set;
	hasRequiredSet = 1;
	const Type2 = requireType();
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	function resolveYamlSet(data) {
		if (data === null) return true;
		const object = data;
		for (const key in object) if (_hasOwnProperty.call(object, key)) {
			if (object[key] !== null) return false;
		}
		return true;
	}
	function constructYamlSet(data) {
		return data !== null ? data : {};
	}
	set = new Type2("tag:yaml.org,2002:set", {
		kind: "mapping",
		resolve: resolveYamlSet,
		construct: constructYamlSet
	});
	return set;
}
var _default;
var hasRequired_default;
function require_default() {
	if (hasRequired_default) return _default;
	hasRequired_default = 1;
	_default = requireCore().extend({
		implicit: [requireTimestamp(), requireMerge()],
		explicit: [
			requireBinary(),
			requireOmap(),
			requirePairs(),
			requireSet()
		]
	});
	return _default;
}
var hasRequiredLoader;
function requireLoader() {
	if (hasRequiredLoader) return loader;
	hasRequiredLoader = 1;
	const common2 = requireCommon();
	const YAMLException2 = requireException();
	const makeSnippet = requireSnippet();
	const DEFAULT_SCHEMA2 = require_default();
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	const CONTEXT_FLOW_IN = 1;
	const CONTEXT_FLOW_OUT = 2;
	const CONTEXT_BLOCK_IN = 3;
	const CONTEXT_BLOCK_OUT = 4;
	const CHOMPING_CLIP = 1;
	const CHOMPING_STRIP = 2;
	const CHOMPING_KEEP = 3;
	const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
	const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
	const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
	const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
	const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
	function _class(obj) {
		return Object.prototype.toString.call(obj);
	}
	function isEol(c) {
		return c === 10 || c === 13;
	}
	function isWhiteSpace(c) {
		return c === 9 || c === 32;
	}
	function isWsOrEol(c) {
		return c === 9 || c === 32 || c === 10 || c === 13;
	}
	function isFlowIndicator(c) {
		return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
	}
	function fromHexCode(c) {
		if (c >= 48 && c <= 57) return c - 48;
		const lc = c | 32;
		if (lc >= 97 && lc <= 102) return lc - 97 + 10;
		return -1;
	}
	function escapedHexLen(c) {
		if (c === 120) return 2;
		if (c === 117) return 4;
		if (c === 85) return 8;
		return 0;
	}
	function fromDecimalCode(c) {
		if (c >= 48 && c <= 57) return c - 48;
		return -1;
	}
	function simpleEscapeSequence(c) {
		switch (c) {
			case 48: return "\0";
			case 97: return "\x07";
			case 98: return "\b";
			case 116: return "	";
			case 9: return "	";
			case 110: return "\n";
			case 118: return "\v";
			case 102: return "\f";
			case 114: return "\r";
			case 101: return "\x1B";
			case 32: return " ";
			case 34: return "\"";
			case 47: return "/";
			case 92: return "\\";
			case 78: return "";
			case 95: return "\xA0";
			case 76: return "\u2028";
			case 80: return "\u2029";
			default: return "";
		}
	}
	function charFromCodepoint(c) {
		if (c <= 65535) return String.fromCharCode(c);
		return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
	}
	function setProperty(object, key, value) {
		if (key === "__proto__") Object.defineProperty(object, key, {
			configurable: true,
			enumerable: true,
			writable: true,
			value
		});
		else object[key] = value;
	}
	const simpleEscapeCheck = new Array(256);
	const simpleEscapeMap = new Array(256);
	for (let i = 0; i < 256; i++) {
		simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
		simpleEscapeMap[i] = simpleEscapeSequence(i);
	}
	function State(input, options) {
		this.input = input;
		this.filename = options["filename"] || null;
		this.schema = options["schema"] || DEFAULT_SCHEMA2;
		this.onWarning = options["onWarning"] || null;
		this.legacy = options["legacy"] || false;
		this.json = options["json"] || false;
		this.listener = options["listener"] || null;
		this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
		this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
		this.implicitTypes = this.schema.compiledImplicit;
		this.typeMap = this.schema.compiledTypeMap;
		this.length = input.length;
		this.position = 0;
		this.line = 0;
		this.lineStart = 0;
		this.lineIndent = 0;
		this.depth = 0;
		this.totalMergeKeys = 0;
		this.firstTabInLine = -1;
		this.documents = [];
		this.anchorMapTransactions = [];
	}
	function generateError(state, message) {
		const mark = {
			name: state.filename,
			buffer: state.input.slice(0, -1),
			position: state.position,
			line: state.line,
			column: state.position - state.lineStart
		};
		mark.snippet = makeSnippet(mark);
		return new YAMLException2(message, mark);
	}
	function throwError(state, message) {
		throw generateError(state, message);
	}
	function throwWarning(state, message) {
		if (state.onWarning) state.onWarning.call(null, generateError(state, message));
	}
	function storeAnchor(state, name, value) {
		const transactions = state.anchorMapTransactions;
		if (transactions.length !== 0) {
			const transaction = transactions[transactions.length - 1];
			if (!_hasOwnProperty.call(transaction, name)) transaction[name] = {
				existed: _hasOwnProperty.call(state.anchorMap, name),
				value: state.anchorMap[name]
			};
		}
		state.anchorMap[name] = value;
	}
	function beginAnchorTransaction(state) {
		state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
	}
	function commitAnchorTransaction(state) {
		const transaction = state.anchorMapTransactions.pop();
		const transactions = state.anchorMapTransactions;
		if (transactions.length === 0) return;
		const parent = transactions[transactions.length - 1];
		const names = Object.keys(transaction);
		for (let index = 0, length = names.length; index < length; index += 1) {
			const name = names[index];
			if (!_hasOwnProperty.call(parent, name)) parent[name] = transaction[name];
		}
	}
	function rollbackAnchorTransaction(state) {
		const transaction = state.anchorMapTransactions.pop();
		const names = Object.keys(transaction);
		for (let index = names.length - 1; index >= 0; index -= 1) {
			const entry = transaction[names[index]];
			if (entry.existed) state.anchorMap[names[index]] = entry.value;
			else delete state.anchorMap[names[index]];
		}
	}
	function snapshotState(state) {
		return {
			position: state.position,
			line: state.line,
			lineStart: state.lineStart,
			lineIndent: state.lineIndent,
			firstTabInLine: state.firstTabInLine,
			tag: state.tag,
			anchor: state.anchor,
			kind: state.kind,
			result: state.result
		};
	}
	function restoreState(state, snapshot) {
		state.position = snapshot.position;
		state.line = snapshot.line;
		state.lineStart = snapshot.lineStart;
		state.lineIndent = snapshot.lineIndent;
		state.firstTabInLine = snapshot.firstTabInLine;
		state.tag = snapshot.tag;
		state.anchor = snapshot.anchor;
		state.kind = snapshot.kind;
		state.result = snapshot.result;
	}
	const directiveHandlers = {
		YAML: function handleYamlDirective(state, name, args) {
			if (state.version !== null) throwError(state, "duplication of %YAML directive");
			if (args.length !== 1) throwError(state, "YAML directive accepts exactly one argument");
			const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
			if (match === null) throwError(state, "ill-formed argument of the YAML directive");
			const major = parseInt(match[1], 10);
			const minor = parseInt(match[2], 10);
			if (major !== 1) throwError(state, "unacceptable YAML version of the document");
			state.version = args[0];
			state.checkLineBreaks = minor < 2;
			if (minor !== 1 && minor !== 2) throwWarning(state, "unsupported YAML version of the document");
		},
		TAG: function handleTagDirective(state, name, args) {
			let prefix;
			if (args.length !== 2) throwError(state, "TAG directive accepts exactly two arguments");
			const handle = args[0];
			prefix = args[1];
			if (!PATTERN_TAG_HANDLE.test(handle)) throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
			if (_hasOwnProperty.call(state.tagMap, handle)) throwError(state, "there is a previously declared suffix for \"" + handle + "\" tag handle");
			if (!PATTERN_TAG_URI.test(prefix)) throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
			try {
				prefix = decodeURIComponent(prefix);
			} catch (err) {
				throwError(state, "tag prefix is malformed: " + prefix);
			}
			state.tagMap[handle] = prefix;
		}
	};
	function captureSegment(state, start, end, checkJson) {
		if (start < end) {
			const _result = state.input.slice(start, end);
			if (checkJson) for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
				const _character = _result.charCodeAt(_position);
				if (!(_character === 9 || _character >= 32 && _character <= 1114111)) throwError(state, "expected valid JSON character");
			}
			else if (PATTERN_NON_PRINTABLE.test(_result)) throwError(state, "the stream contains non-printable characters");
			state.result += _result;
		}
	}
	function chargeMergeWork(state) {
		state.totalMergeKeys++;
		if (state.maxTotalMergeKeys !== -1 && state.totalMergeKeys > state.maxTotalMergeKeys) throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
	}
	function mergeMappings(state, destination, source, overridableKeys) {
		if (!common2.isObject(source)) throwError(state, "cannot merge mappings; the provided source object is unacceptable");
		chargeMergeWork(state);
		const sourceKeys = Object.keys(source);
		for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
			const key = sourceKeys[index];
			chargeMergeWork(state);
			if (!_hasOwnProperty.call(destination, key)) {
				setProperty(destination, key, source[key]);
				overridableKeys[key] = true;
			}
		}
	}
	function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
		if (Array.isArray(keyNode)) {
			keyNode = Array.prototype.slice.call(keyNode);
			for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
				if (Array.isArray(keyNode[index])) throwError(state, "nested arrays are not supported inside keys");
				if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") keyNode[index] = "[object Object]";
			}
		}
		if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") keyNode = "[object Object]";
		keyNode = String(keyNode);
		if (_result === null) _result = {};
		if (keyTag === "tag:yaml.org,2002:merge") if (Array.isArray(valueNode)) {
			if (valueNode.length > 100) throwError(state, "abnormal merge sequence size");
			for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) mergeMappings(state, _result, valueNode[index], overridableKeys);
		} else mergeMappings(state, _result, valueNode, overridableKeys);
		else {
			if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
				state.line = startLine || state.line;
				state.lineStart = startLineStart || state.lineStart;
				state.position = startPos || state.position;
				throwError(state, "duplicated mapping key");
			}
			setProperty(_result, keyNode, valueNode);
			delete overridableKeys[keyNode];
		}
		return _result;
	}
	function readLineBreak(state) {
		const ch = state.input.charCodeAt(state.position);
		if (ch === 10) state.position++;
		else if (ch === 13) {
			state.position++;
			if (state.input.charCodeAt(state.position) === 10) state.position++;
		} else throwError(state, "a line break is expected");
		state.line += 1;
		state.lineStart = state.position;
		state.firstTabInLine = -1;
	}
	function skipSeparationSpace(state, allowComments, checkIndent) {
		let lineBreaks = 0;
		let ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			while (isWhiteSpace(ch)) {
				if (ch === 9 && state.firstTabInLine === -1) state.firstTabInLine = state.position;
				ch = state.input.charCodeAt(++state.position);
			}
			if (allowComments && ch === 35) do
				ch = state.input.charCodeAt(++state.position);
			while (ch !== 10 && ch !== 13 && ch !== 0);
			if (isEol(ch)) {
				readLineBreak(state);
				ch = state.input.charCodeAt(state.position);
				lineBreaks++;
				state.lineIndent = 0;
				while (ch === 32) {
					state.lineIndent++;
					ch = state.input.charCodeAt(++state.position);
				}
			} else break;
		}
		if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) throwWarning(state, "deficient indentation");
		return lineBreaks;
	}
	function testDocumentSeparator(state) {
		let _position = state.position;
		let ch = state.input.charCodeAt(_position);
		if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
			_position += 3;
			ch = state.input.charCodeAt(_position);
			if (ch === 0 || isWsOrEol(ch)) return true;
		}
		return false;
	}
	function writeFoldedLines(state, count) {
		if (count === 1) state.result += " ";
		else if (count > 1) state.result += common2.repeat("\n", count - 1);
	}
	function readPlainScalar(state, nodeIndent, withinFlowCollection) {
		let captureStart;
		let captureEnd;
		let hasPendingContent;
		let _line;
		let _lineStart;
		let _lineIndent;
		const _kind = state.kind;
		const _result = state.result;
		let ch = state.input.charCodeAt(state.position);
		if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) return false;
		if (ch === 63 || ch === 45) {
			const following = state.input.charCodeAt(state.position + 1);
			if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) return false;
		}
		state.kind = "scalar";
		state.result = "";
		captureStart = captureEnd = state.position;
		hasPendingContent = false;
		while (ch !== 0) {
			if (ch === 58) {
				const following = state.input.charCodeAt(state.position + 1);
				if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) break;
			} else if (ch === 35) {
				if (isWsOrEol(state.input.charCodeAt(state.position - 1))) break;
			} else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) break;
			else if (isEol(ch)) {
				_line = state.line;
				_lineStart = state.lineStart;
				_lineIndent = state.lineIndent;
				skipSeparationSpace(state, false, -1);
				if (state.lineIndent >= nodeIndent) {
					hasPendingContent = true;
					ch = state.input.charCodeAt(state.position);
					continue;
				} else {
					state.position = captureEnd;
					state.line = _line;
					state.lineStart = _lineStart;
					state.lineIndent = _lineIndent;
					break;
				}
			}
			if (hasPendingContent) {
				captureSegment(state, captureStart, captureEnd, false);
				writeFoldedLines(state, state.line - _line);
				captureStart = captureEnd = state.position;
				hasPendingContent = false;
			}
			if (!isWhiteSpace(ch)) captureEnd = state.position + 1;
			ch = state.input.charCodeAt(++state.position);
		}
		captureSegment(state, captureStart, captureEnd, false);
		if (state.result) return true;
		state.kind = _kind;
		state.result = _result;
		return false;
	}
	function readSingleQuotedScalar(state, nodeIndent) {
		let captureStart;
		let captureEnd;
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 39) return false;
		state.kind = "scalar";
		state.result = "";
		state.position++;
		captureStart = captureEnd = state.position;
		while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 39) {
			captureSegment(state, captureStart, state.position, true);
			ch = state.input.charCodeAt(++state.position);
			if (ch === 39) {
				captureStart = state.position;
				state.position++;
				captureEnd = state.position;
			} else return true;
		} else if (isEol(ch)) {
			captureSegment(state, captureStart, captureEnd, true);
			writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
			captureStart = captureEnd = state.position;
		} else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a single quoted scalar");
		else {
			state.position++;
			if (!isWhiteSpace(ch)) captureEnd = state.position;
		}
		throwError(state, "unexpected end of the stream within a single quoted scalar");
	}
	function readDoubleQuotedScalar(state, nodeIndent) {
		let captureStart;
		let captureEnd;
		let tmp;
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 34) return false;
		state.kind = "scalar";
		state.result = "";
		state.position++;
		captureStart = captureEnd = state.position;
		while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 34) {
			captureSegment(state, captureStart, state.position, true);
			state.position++;
			return true;
		} else if (ch === 92) {
			captureSegment(state, captureStart, state.position, true);
			ch = state.input.charCodeAt(++state.position);
			if (isEol(ch)) skipSeparationSpace(state, false, nodeIndent);
			else if (ch < 256 && simpleEscapeCheck[ch]) {
				state.result += simpleEscapeMap[ch];
				state.position++;
			} else if ((tmp = escapedHexLen(ch)) > 0) {
				let hexLength = tmp;
				let hexResult = 0;
				for (; hexLength > 0; hexLength--) {
					ch = state.input.charCodeAt(++state.position);
					if ((tmp = fromHexCode(ch)) >= 0) hexResult = (hexResult << 4) + tmp;
					else throwError(state, "expected hexadecimal character");
				}
				state.result += charFromCodepoint(hexResult);
				state.position++;
			} else throwError(state, "unknown escape sequence");
			captureStart = captureEnd = state.position;
		} else if (isEol(ch)) {
			captureSegment(state, captureStart, captureEnd, true);
			writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
			captureStart = captureEnd = state.position;
		} else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a double quoted scalar");
		else {
			state.position++;
			if (!isWhiteSpace(ch)) captureEnd = state.position;
		}
		throwError(state, "unexpected end of the stream within a double quoted scalar");
	}
	function readFlowCollection(state, nodeIndent) {
		let readNext = true;
		let _line;
		let _lineStart;
		let _pos;
		const _tag = state.tag;
		let _result;
		const _anchor = state.anchor;
		let terminator;
		let isPair;
		let isExplicitPair;
		let isMapping;
		const overridableKeys = /* @__PURE__ */ Object.create(null);
		let keyNode;
		let keyTag;
		let valueNode;
		let ch = state.input.charCodeAt(state.position);
		if (ch === 91) {
			terminator = 93;
			isMapping = false;
			_result = [];
		} else if (ch === 123) {
			terminator = 125;
			isMapping = true;
			_result = {};
		} else return false;
		if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
		ch = state.input.charCodeAt(++state.position);
		while (ch !== 0) {
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if (ch === terminator) {
				state.position++;
				state.tag = _tag;
				state.anchor = _anchor;
				state.kind = isMapping ? "mapping" : "sequence";
				state.result = _result;
				return true;
			} else if (!readNext) throwError(state, "missed comma between flow collection entries");
			else if (ch === 44) throwError(state, "expected the node content, but found ','");
			keyTag = keyNode = valueNode = null;
			isPair = isExplicitPair = false;
			if (ch === 63) {
				if (isWsOrEol(state.input.charCodeAt(state.position + 1))) {
					isPair = isExplicitPair = true;
					state.position++;
					skipSeparationSpace(state, true, nodeIndent);
				}
			}
			_line = state.line;
			_lineStart = state.lineStart;
			_pos = state.position;
			composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
			keyTag = state.tag;
			keyNode = state.result;
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if ((isExplicitPair || state.line === _line) && ch === 58) {
				isPair = true;
				ch = state.input.charCodeAt(++state.position);
				skipSeparationSpace(state, true, nodeIndent);
				composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
				valueNode = state.result;
			}
			if (isMapping) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
			else if (isPair) _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
			else _result.push(keyNode);
			skipSeparationSpace(state, true, nodeIndent);
			ch = state.input.charCodeAt(state.position);
			if (ch === 44) {
				readNext = true;
				ch = state.input.charCodeAt(++state.position);
			} else readNext = false;
		}
		throwError(state, "unexpected end of the stream within a flow collection");
	}
	function readBlockScalar(state, nodeIndent) {
		let folding;
		let chomping = CHOMPING_CLIP;
		let didReadContent = false;
		let detectedIndent = false;
		let textIndent = nodeIndent;
		let emptyLines = 0;
		let atMoreIndented = false;
		let tmp;
		let ch = state.input.charCodeAt(state.position);
		if (ch === 124) folding = false;
		else if (ch === 62) folding = true;
		else return false;
		state.kind = "scalar";
		state.result = "";
		while (ch !== 0) {
			ch = state.input.charCodeAt(++state.position);
			if (ch === 43 || ch === 45) if (CHOMPING_CLIP === chomping) chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
			else throwError(state, "repeat of a chomping mode identifier");
			else if ((tmp = fromDecimalCode(ch)) >= 0) if (tmp === 0) throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
			else if (!detectedIndent) {
				textIndent = nodeIndent + tmp - 1;
				detectedIndent = true;
			} else throwError(state, "repeat of an indentation width identifier");
			else break;
		}
		if (isWhiteSpace(ch)) {
			do
				ch = state.input.charCodeAt(++state.position);
			while (isWhiteSpace(ch));
			if (ch === 35) do
				ch = state.input.charCodeAt(++state.position);
			while (!isEol(ch) && ch !== 0);
		}
		while (ch !== 0) {
			readLineBreak(state);
			state.lineIndent = 0;
			ch = state.input.charCodeAt(state.position);
			while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
				state.lineIndent++;
				ch = state.input.charCodeAt(++state.position);
			}
			if (!detectedIndent && state.lineIndent > textIndent) textIndent = state.lineIndent;
			if (isEol(ch)) {
				emptyLines++;
				continue;
			}
			if (!detectedIndent && textIndent === 0) throwError(state, "missing indentation for block scalar");
			if (state.lineIndent < textIndent) {
				if (chomping === CHOMPING_KEEP) state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
				else if (chomping === CHOMPING_CLIP) {
					if (didReadContent) state.result += "\n";
				}
				break;
			}
			if (folding) if (isWhiteSpace(ch)) {
				atMoreIndented = true;
				state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
			} else if (atMoreIndented) {
				atMoreIndented = false;
				state.result += common2.repeat("\n", emptyLines + 1);
			} else if (emptyLines === 0) {
				if (didReadContent) state.result += " ";
			} else state.result += common2.repeat("\n", emptyLines);
			else state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
			didReadContent = true;
			detectedIndent = true;
			emptyLines = 0;
			const captureStart = state.position;
			while (!isEol(ch) && ch !== 0) ch = state.input.charCodeAt(++state.position);
			captureSegment(state, captureStart, state.position, false);
		}
		return true;
	}
	function readBlockSequence(state, nodeIndent) {
		const _tag = state.tag;
		const _anchor = state.anchor;
		const _result = [];
		let detected = false;
		if (state.firstTabInLine !== -1) return false;
		if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
		let ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			if (state.firstTabInLine !== -1) {
				state.position = state.firstTabInLine;
				throwError(state, "tab characters must not be used in indentation");
			}
			if (ch !== 45) break;
			if (!isWsOrEol(state.input.charCodeAt(state.position + 1))) break;
			detected = true;
			state.position++;
			if (skipSeparationSpace(state, true, -1)) {
				if (state.lineIndent <= nodeIndent) {
					_result.push(null);
					ch = state.input.charCodeAt(state.position);
					continue;
				}
			}
			const _line = state.line;
			composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
			_result.push(state.result);
			skipSeparationSpace(state, true, -1);
			ch = state.input.charCodeAt(state.position);
			if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a sequence entry");
			else if (state.lineIndent < nodeIndent) break;
		}
		if (detected) {
			state.tag = _tag;
			state.anchor = _anchor;
			state.kind = "sequence";
			state.result = _result;
			return true;
		}
		return false;
	}
	function readBlockMapping(state, nodeIndent, flowIndent) {
		let allowCompact;
		let _keyLine;
		let _keyLineStart;
		let _keyPos;
		const _tag = state.tag;
		const _anchor = state.anchor;
		const _result = {};
		const overridableKeys = /* @__PURE__ */ Object.create(null);
		let keyTag = null;
		let keyNode = null;
		let valueNode = null;
		let atExplicitKey = false;
		let detected = false;
		if (state.firstTabInLine !== -1) return false;
		if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
		let ch = state.input.charCodeAt(state.position);
		while (ch !== 0) {
			if (!atExplicitKey && state.firstTabInLine !== -1) {
				state.position = state.firstTabInLine;
				throwError(state, "tab characters must not be used in indentation");
			}
			const following = state.input.charCodeAt(state.position + 1);
			const _line = state.line;
			if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
				if (ch === 63) {
					if (atExplicitKey) {
						storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
						keyTag = keyNode = valueNode = null;
					}
					detected = true;
					atExplicitKey = true;
					allowCompact = true;
				} else if (atExplicitKey) {
					atExplicitKey = false;
					allowCompact = true;
				} else throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
				state.position += 1;
				ch = following;
			} else {
				_keyLine = state.line;
				_keyLineStart = state.lineStart;
				_keyPos = state.position;
				if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) break;
				if (state.line === _line) {
					ch = state.input.charCodeAt(state.position);
					while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
					if (ch === 58) {
						ch = state.input.charCodeAt(++state.position);
						if (!isWsOrEol(ch)) throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
						if (atExplicitKey) {
							storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
							keyTag = keyNode = valueNode = null;
						}
						detected = true;
						atExplicitKey = false;
						allowCompact = false;
						keyTag = state.tag;
						keyNode = state.result;
					} else if (detected) throwError(state, "can not read an implicit mapping pair; a colon is missed");
					else {
						state.tag = _tag;
						state.anchor = _anchor;
						return true;
					}
				} else if (detected) throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
				else {
					state.tag = _tag;
					state.anchor = _anchor;
					return true;
				}
			}
			if (state.line === _line || state.lineIndent > nodeIndent) {
				if (atExplicitKey) {
					_keyLine = state.line;
					_keyLineStart = state.lineStart;
					_keyPos = state.position;
				}
				if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) if (atExplicitKey) keyNode = state.result;
				else valueNode = state.result;
				if (!atExplicitKey) {
					storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
					keyTag = keyNode = valueNode = null;
				}
				skipSeparationSpace(state, true, -1);
				ch = state.input.charCodeAt(state.position);
			}
			if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a mapping entry");
			else if (state.lineIndent < nodeIndent) break;
		}
		if (atExplicitKey) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
		if (detected) {
			state.tag = _tag;
			state.anchor = _anchor;
			state.kind = "mapping";
			state.result = _result;
		}
		return detected;
	}
	function readTagProperty(state) {
		let isVerbatim = false;
		let isNamed = false;
		let tagHandle;
		let tagName;
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 33) return false;
		if (state.tag !== null) throwError(state, "duplication of a tag property");
		ch = state.input.charCodeAt(++state.position);
		if (ch === 60) {
			isVerbatim = true;
			ch = state.input.charCodeAt(++state.position);
		} else if (ch === 33) {
			isNamed = true;
			tagHandle = "!!";
			ch = state.input.charCodeAt(++state.position);
		} else tagHandle = "!";
		let _position = state.position;
		if (isVerbatim) {
			do
				ch = state.input.charCodeAt(++state.position);
			while (ch !== 0 && ch !== 62);
			if (state.position < state.length) {
				tagName = state.input.slice(_position, state.position);
				ch = state.input.charCodeAt(++state.position);
			} else throwError(state, "unexpected end of the stream within a verbatim tag");
		} else {
			while (ch !== 0 && !isWsOrEol(ch)) {
				if (ch === 33) if (!isNamed) {
					tagHandle = state.input.slice(_position - 1, state.position + 1);
					if (!PATTERN_TAG_HANDLE.test(tagHandle)) throwError(state, "named tag handle cannot contain such characters");
					isNamed = true;
					_position = state.position + 1;
				} else throwError(state, "tag suffix cannot contain exclamation marks");
				ch = state.input.charCodeAt(++state.position);
			}
			tagName = state.input.slice(_position, state.position);
			if (PATTERN_FLOW_INDICATORS.test(tagName)) throwError(state, "tag suffix cannot contain flow indicator characters");
		}
		if (tagName && !PATTERN_TAG_URI.test(tagName)) throwError(state, "tag name cannot contain such characters: " + tagName);
		try {
			tagName = decodeURIComponent(tagName);
		} catch (err) {
			throwError(state, "tag name is malformed: " + tagName);
		}
		if (isVerbatim) state.tag = tagName;
		else if (_hasOwnProperty.call(state.tagMap, tagHandle)) state.tag = state.tagMap[tagHandle] + tagName;
		else if (tagHandle === "!") state.tag = "!" + tagName;
		else if (tagHandle === "!!") state.tag = "tag:yaml.org,2002:" + tagName;
		else throwError(state, "undeclared tag handle \"" + tagHandle + "\"");
		return true;
	}
	function readAnchorProperty(state) {
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 38) return false;
		if (state.anchor !== null) throwError(state, "duplication of an anchor property");
		ch = state.input.charCodeAt(++state.position);
		const _position = state.position;
		while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
		if (state.position === _position) throwError(state, "name of an anchor node must contain at least one character");
		state.anchor = state.input.slice(_position, state.position);
		return true;
	}
	function readAlias(state) {
		let ch = state.input.charCodeAt(state.position);
		if (ch !== 42) return false;
		ch = state.input.charCodeAt(++state.position);
		const _position = state.position;
		while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
		if (state.position === _position) throwError(state, "name of an alias node must contain at least one character");
		const alias = state.input.slice(_position, state.position);
		if (!_hasOwnProperty.call(state.anchorMap, alias)) throwError(state, "unidentified alias \"" + alias + "\"");
		state.result = state.anchorMap[alias];
		skipSeparationSpace(state, true, -1);
		return true;
	}
	function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
		const fallbackState = snapshotState(state);
		beginAnchorTransaction(state);
		restoreState(state, propertyStart);
		state.tag = null;
		state.anchor = null;
		state.kind = null;
		state.result = null;
		if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
			commitAnchorTransaction(state);
			return true;
		}
		rollbackAnchorTransaction(state);
		restoreState(state, fallbackState);
		return false;
	}
	function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
		let allowBlockScalars;
		let allowBlockCollections;
		let indentStatus = 1;
		let atNewLine = false;
		let hasContent = false;
		let propertyStart = null;
		let type2;
		let flowIndent;
		let blockIndent;
		if (state.depth >= state.maxDepth) throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
		state.depth += 1;
		if (state.listener !== null) state.listener("open", state);
		state.tag = null;
		state.anchor = null;
		state.kind = null;
		state.result = null;
		const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
		if (allowToSeek) {
			if (skipSeparationSpace(state, true, -1)) {
				atNewLine = true;
				if (state.lineIndent > parentIndent) indentStatus = 1;
				else if (state.lineIndent === parentIndent) indentStatus = 0;
				else if (state.lineIndent < parentIndent) indentStatus = -1;
			}
		}
		if (indentStatus === 1) while (true) {
			const ch = state.input.charCodeAt(state.position);
			const propertyState = snapshotState(state);
			if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) break;
			if (!readTagProperty(state) && !readAnchorProperty(state)) break;
			if (propertyStart === null) propertyStart = propertyState;
			if (skipSeparationSpace(state, true, -1)) {
				atNewLine = true;
				allowBlockCollections = allowBlockStyles;
				if (state.lineIndent > parentIndent) indentStatus = 1;
				else if (state.lineIndent === parentIndent) indentStatus = 0;
				else if (state.lineIndent < parentIndent) indentStatus = -1;
			} else allowBlockCollections = false;
		}
		if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact;
		if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
			if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) flowIndent = parentIndent;
			else flowIndent = parentIndent + 1;
			blockIndent = state.position - state.lineStart;
			if (indentStatus === 1) if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) hasContent = true;
			else {
				const ch = state.input.charCodeAt(state.position);
				if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(state, propertyStart, propertyStart.position - propertyStart.lineStart, flowIndent)) hasContent = true;
				else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) hasContent = true;
				else if (readAlias(state)) {
					hasContent = true;
					if (state.tag !== null || state.anchor !== null) throwError(state, "alias node should not have any properties");
				} else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
					hasContent = true;
					if (state.tag === null) state.tag = "?";
				}
				if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
			}
			else if (indentStatus === 0) hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
		}
		if (state.tag === null) {
			if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
		} else if (state.tag === "?") {
			if (state.result !== null && state.kind !== "scalar") throwError(state, "unacceptable node kind for !<?> tag; it should be \"scalar\", not \"" + state.kind + "\"");
			for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
				type2 = state.implicitTypes[typeIndex];
				if (type2.resolve(state.result)) {
					state.result = type2.construct(state.result);
					state.tag = type2.tag;
					if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
					break;
				}
			}
		} else if (state.tag !== "!") {
			if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) type2 = state.typeMap[state.kind || "fallback"][state.tag];
			else {
				type2 = null;
				const typeList = state.typeMap.multi[state.kind || "fallback"];
				for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
					type2 = typeList[typeIndex];
					break;
				}
			}
			if (!type2) throwError(state, "unknown tag !<" + state.tag + ">");
			if (state.result !== null && type2.kind !== state.kind) throwError(state, "unacceptable node kind for !<" + state.tag + "> tag; it should be \"" + type2.kind + "\", not \"" + state.kind + "\"");
			if (!type2.resolve(state.result, state.tag)) throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
			else {
				state.result = type2.construct(state.result, state.tag);
				if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
			}
		}
		if (state.listener !== null) state.listener("close", state);
		state.depth -= 1;
		return state.tag !== null || state.anchor !== null || hasContent;
	}
	function readDocument(state) {
		const documentStart = state.position;
		let hasDirectives = false;
		let ch;
		state.version = null;
		state.checkLineBreaks = state.legacy;
		state.tagMap = /* @__PURE__ */ Object.create(null);
		state.anchorMap = /* @__PURE__ */ Object.create(null);
		while ((ch = state.input.charCodeAt(state.position)) !== 0) {
			skipSeparationSpace(state, true, -1);
			ch = state.input.charCodeAt(state.position);
			if (state.lineIndent > 0 || ch !== 37) break;
			hasDirectives = true;
			ch = state.input.charCodeAt(++state.position);
			let _position = state.position;
			while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
			const directiveName = state.input.slice(_position, state.position);
			const directiveArgs = [];
			if (directiveName.length < 1) throwError(state, "directive name must not be less than one character in length");
			while (ch !== 0) {
				while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
				if (ch === 35) {
					do
						ch = state.input.charCodeAt(++state.position);
					while (ch !== 0 && !isEol(ch));
					break;
				}
				if (isEol(ch)) break;
				_position = state.position;
				while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
				directiveArgs.push(state.input.slice(_position, state.position));
			}
			if (ch !== 0) readLineBreak(state);
			if (_hasOwnProperty.call(directiveHandlers, directiveName)) directiveHandlers[directiveName](state, directiveName, directiveArgs);
			else throwWarning(state, "unknown document directive \"" + directiveName + "\"");
		}
		skipSeparationSpace(state, true, -1);
		if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
			state.position += 3;
			skipSeparationSpace(state, true, -1);
		} else if (hasDirectives) throwError(state, "directives end mark is expected");
		composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
		skipSeparationSpace(state, true, -1);
		if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) throwWarning(state, "non-ASCII line breaks are interpreted as content");
		state.documents.push(state.result);
		if (state.position === state.lineStart && testDocumentSeparator(state)) {
			if (state.input.charCodeAt(state.position) === 46) {
				state.position += 3;
				skipSeparationSpace(state, true, -1);
			}
			return;
		}
		if (state.position < state.length - 1) throwError(state, "end of the stream or a document separator is expected");
	}
	function loadDocuments(input, options) {
		input = String(input);
		options = options || {};
		if (input.length !== 0) {
			if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) input += "\n";
			if (input.charCodeAt(0) === 65279) input = input.slice(1);
		}
		const state = new State(input, options);
		const nullpos = input.indexOf("\0");
		if (nullpos !== -1) {
			state.position = nullpos;
			throwError(state, "null byte is not allowed in input");
		}
		state.input += "\0";
		while (state.input.charCodeAt(state.position) === 32) {
			state.lineIndent += 1;
			state.position += 1;
		}
		while (state.position < state.length - 1) readDocument(state);
		return state.documents;
	}
	function loadAll2(input, iterator, options) {
		if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
			options = iterator;
			iterator = null;
		}
		const documents = loadDocuments(input, options);
		if (typeof iterator !== "function") return documents;
		for (let index = 0, length = documents.length; index < length; index += 1) iterator(documents[index]);
	}
	function load2(input, options) {
		const documents = loadDocuments(input, options);
		if (documents.length === 0) return;
		else if (documents.length === 1) return documents[0];
		throw new YAMLException2("expected a single document in the stream, but found more");
	}
	loader.loadAll = loadAll2;
	loader.load = load2;
	return loader;
}
var dumper = {};
var hasRequiredDumper;
function requireDumper() {
	if (hasRequiredDumper) return dumper;
	hasRequiredDumper = 1;
	const common2 = requireCommon();
	const YAMLException2 = requireException();
	const DEFAULT_SCHEMA2 = require_default();
	const _toString = Object.prototype.toString;
	const _hasOwnProperty = Object.prototype.hasOwnProperty;
	const CHAR_BOM = 65279;
	const CHAR_TAB = 9;
	const CHAR_LINE_FEED = 10;
	const CHAR_CARRIAGE_RETURN = 13;
	const CHAR_SPACE = 32;
	const CHAR_EXCLAMATION = 33;
	const CHAR_DOUBLE_QUOTE = 34;
	const CHAR_SHARP = 35;
	const CHAR_PERCENT = 37;
	const CHAR_AMPERSAND = 38;
	const CHAR_SINGLE_QUOTE = 39;
	const CHAR_ASTERISK = 42;
	const CHAR_COMMA = 44;
	const CHAR_MINUS = 45;
	const CHAR_COLON = 58;
	const CHAR_EQUALS = 61;
	const CHAR_GREATER_THAN = 62;
	const CHAR_QUESTION = 63;
	const CHAR_COMMERCIAL_AT = 64;
	const CHAR_LEFT_SQUARE_BRACKET = 91;
	const CHAR_RIGHT_SQUARE_BRACKET = 93;
	const CHAR_GRAVE_ACCENT = 96;
	const CHAR_LEFT_CURLY_BRACKET = 123;
	const CHAR_VERTICAL_LINE = 124;
	const CHAR_RIGHT_CURLY_BRACKET = 125;
	const ESCAPE_SEQUENCES = {};
	ESCAPE_SEQUENCES[0] = "\\0";
	ESCAPE_SEQUENCES[7] = "\\a";
	ESCAPE_SEQUENCES[8] = "\\b";
	ESCAPE_SEQUENCES[9] = "\\t";
	ESCAPE_SEQUENCES[10] = "\\n";
	ESCAPE_SEQUENCES[11] = "\\v";
	ESCAPE_SEQUENCES[12] = "\\f";
	ESCAPE_SEQUENCES[13] = "\\r";
	ESCAPE_SEQUENCES[27] = "\\e";
	ESCAPE_SEQUENCES[34] = "\\\"";
	ESCAPE_SEQUENCES[92] = "\\\\";
	ESCAPE_SEQUENCES[133] = "\\N";
	ESCAPE_SEQUENCES[160] = "\\_";
	ESCAPE_SEQUENCES[8232] = "\\L";
	ESCAPE_SEQUENCES[8233] = "\\P";
	const DEPRECATED_BOOLEANS_SYNTAX = [
		"y",
		"Y",
		"yes",
		"Yes",
		"YES",
		"on",
		"On",
		"ON",
		"n",
		"N",
		"no",
		"No",
		"NO",
		"off",
		"Off",
		"OFF"
	];
	const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
	function compileStyleMap(schema2, map2) {
		if (map2 === null) return {};
		const result = {};
		const keys = Object.keys(map2);
		for (let index = 0, length = keys.length; index < length; index += 1) {
			let tag = keys[index];
			let style = String(map2[tag]);
			if (tag.slice(0, 2) === "!!") tag = "tag:yaml.org,2002:" + tag.slice(2);
			const type2 = schema2.compiledTypeMap["fallback"][tag];
			if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) style = type2.styleAliases[style];
			result[tag] = style;
		}
		return result;
	}
	function encodeHex(character) {
		let handle;
		let length;
		const string = character.toString(16).toUpperCase();
		if (character <= 255) {
			handle = "x";
			length = 2;
		} else if (character <= 65535) {
			handle = "u";
			length = 4;
		} else if (character <= 4294967295) {
			handle = "U";
			length = 8;
		} else throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
		return "\\" + handle + common2.repeat("0", length - string.length) + string;
	}
	const QUOTING_TYPE_SINGLE = 1;
	const QUOTING_TYPE_DOUBLE = 2;
	function State(options) {
		this.schema = options["schema"] || DEFAULT_SCHEMA2;
		this.indent = Math.max(1, options["indent"] || 2);
		this.noArrayIndent = options["noArrayIndent"] || false;
		this.skipInvalid = options["skipInvalid"] || false;
		this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
		this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
		this.sortKeys = options["sortKeys"] || false;
		this.lineWidth = options["lineWidth"] || 80;
		this.noRefs = options["noRefs"] || false;
		this.noCompatMode = options["noCompatMode"] || false;
		this.condenseFlow = options["condenseFlow"] || false;
		this.quotingType = options["quotingType"] === "\"" ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
		this.forceQuotes = options["forceQuotes"] || false;
		this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
		this.implicitTypes = this.schema.compiledImplicit;
		this.explicitTypes = this.schema.compiledExplicit;
		this.tag = null;
		this.result = "";
		this.duplicates = [];
		this.usedDuplicates = null;
	}
	function indentString(string, spaces) {
		const ind = common2.repeat(" ", spaces);
		let position = 0;
		let result = "";
		const length = string.length;
		while (position < length) {
			let line;
			const next = string.indexOf("\n", position);
			if (next === -1) {
				line = string.slice(position);
				position = length;
			} else {
				line = string.slice(position, next + 1);
				position = next + 1;
			}
			if (line.length && line !== "\n") result += ind;
			result += line;
		}
		return result;
	}
	function generateNextLine(state, level) {
		return "\n" + common2.repeat(" ", state.indent * level);
	}
	function testImplicitResolving(state, str2) {
		for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) if (state.implicitTypes[index].resolve(str2)) return true;
		return false;
	}
	function isWhitespace(c) {
		return c === CHAR_SPACE || c === CHAR_TAB;
	}
	function isPrintable(c) {
		return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
	}
	function isNsCharOrWhitespace(c) {
		return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
	}
	function isPlainSafe(c, prev, inblock) {
		const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
		const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
		return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
	}
	function isPlainSafeFirst(c) {
		return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
	}
	function isPlainSafeLast(c) {
		return !isWhitespace(c) && c !== CHAR_COLON;
	}
	function codePointAt(string, pos) {
		const first = string.charCodeAt(pos);
		let second;
		if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
			second = string.charCodeAt(pos + 1);
			if (second >= 56320 && second <= 57343) return (first - 55296) * 1024 + second - 56320 + 65536;
		}
		return first;
	}
	function needIndentIndicator(string) {
		return /^\n* /.test(string);
	}
	const STYLE_PLAIN = 1;
	const STYLE_SINGLE = 2;
	const STYLE_LITERAL = 3;
	const STYLE_FOLDED = 4;
	const STYLE_DOUBLE = 5;
	function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
		let i;
		let char = 0;
		let prevChar = null;
		let hasLineBreak = false;
		let hasFoldableLine = false;
		const shouldTrackWidth = lineWidth !== -1;
		let previousLineBreak = -1;
		let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
		if (singleLineOnly || forceQuotes) for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
			char = codePointAt(string, i);
			if (!isPrintable(char)) return STYLE_DOUBLE;
			plain = plain && isPlainSafe(char, prevChar, inblock);
			prevChar = char;
		}
		else {
			for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
				char = codePointAt(string, i);
				if (char === CHAR_LINE_FEED) {
					hasLineBreak = true;
					if (shouldTrackWidth) {
						hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
						previousLineBreak = i;
					}
				} else if (!isPrintable(char)) return STYLE_DOUBLE;
				plain = plain && isPlainSafe(char, prevChar, inblock);
				prevChar = char;
			}
			hasFoldableLine = hasFoldableLine || shouldTrackWidth && i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
		}
		if (!hasLineBreak && !hasFoldableLine) {
			if (plain && !forceQuotes && !testAmbiguousType(string)) return STYLE_PLAIN;
			return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
		}
		if (indentPerLevel > 9 && needIndentIndicator(string)) return STYLE_DOUBLE;
		if (!forceQuotes) return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
		return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
	}
	function writeScalar(state, string, level, iskey, inblock) {
		state.dump = (function() {
			if (string.length === 0) return state.quotingType === QUOTING_TYPE_DOUBLE ? "\"\"" : "''";
			if (!state.noCompatMode) {
				if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) return state.quotingType === QUOTING_TYPE_DOUBLE ? "\"" + string + "\"" : "'" + string + "'";
			}
			const indent = state.indent * Math.max(1, level);
			const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
			const singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
			function testAmbiguity(string2) {
				return testImplicitResolving(state, string2);
			}
			switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
				case STYLE_PLAIN: return string;
				case STYLE_SINGLE: return "'" + string.replace(/'/g, "''") + "'";
				case STYLE_LITERAL: return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
				case STYLE_FOLDED: return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
				case STYLE_DOUBLE: return "\"" + escapeString(string) + "\"";
				default: throw new YAMLException2("impossible error: invalid scalar style");
			}
		})();
	}
	function blockHeader(string, indentPerLevel) {
		const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
		const clip = string[string.length - 1] === "\n";
		return indentIndicator + (clip && (string[string.length - 2] === "\n" || string === "\n") ? "+" : clip ? "" : "-") + "\n";
	}
	function dropEndingNewline(string) {
		return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
	}
	function foldString(string, width) {
		const lineRe = /(\n+)([^\n]*)/g;
		let result = (function() {
			let nextLF = string.indexOf("\n");
			nextLF = nextLF !== -1 ? nextLF : string.length;
			lineRe.lastIndex = nextLF;
			return foldLine(string.slice(0, nextLF), width);
		})();
		let prevMoreIndented = string[0] === "\n" || string[0] === " ";
		let moreIndented;
		let match;
		while (match = lineRe.exec(string)) {
			const prefix = match[1];
			const line = match[2];
			moreIndented = line[0] === " ";
			result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
			prevMoreIndented = moreIndented;
		}
		return result;
	}
	function foldLine(line, width) {
		if (line === "" || line[0] === " ") return line;
		const breakRe = / [^ ]/g;
		let match;
		let start = 0;
		let end;
		let curr = 0;
		let next = 0;
		let result = "";
		while (match = breakRe.exec(line)) {
			next = match.index;
			if (next - start > width) {
				end = curr > start ? curr : next;
				result += "\n" + line.slice(start, end);
				start = end + 1;
			}
			curr = next;
		}
		result += "\n";
		if (line.length - start > width && curr > start) result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
		else result += line.slice(start);
		return result.slice(1);
	}
	function escapeString(string) {
		let result = "";
		let char = 0;
		for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
			char = codePointAt(string, i);
			const escapeSeq = ESCAPE_SEQUENCES[char];
			if (!escapeSeq && isPrintable(char)) {
				result += string[i];
				if (char >= 65536) result += string[i + 1];
			} else result += escapeSeq || encodeHex(char);
		}
		return result;
	}
	function writeFlowSequence(state, level, object) {
		let _result = "";
		const _tag = state.tag;
		for (let index = 0, length = object.length; index < length; index += 1) {
			let value = object[index];
			if (state.replacer) value = state.replacer.call(object, String(index), value);
			if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
				if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
				_result += state.dump;
			}
		}
		state.tag = _tag;
		state.dump = "[" + _result + "]";
	}
	function writeBlockSequence(state, level, object, compact) {
		let _result = "";
		const _tag = state.tag;
		for (let index = 0, length = object.length; index < length; index += 1) {
			let value = object[index];
			if (state.replacer) value = state.replacer.call(object, String(index), value);
			if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
				if (!compact || _result !== "") _result += generateNextLine(state, level);
				if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) _result += "-";
				else _result += "- ";
				_result += state.dump;
			}
		}
		state.tag = _tag;
		state.dump = _result || "[]";
	}
	function writeFlowMapping(state, level, object) {
		let _result = "";
		const _tag = state.tag;
		const objectKeyList = Object.keys(object);
		for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
			let pairBuffer = "";
			if (_result !== "") pairBuffer += ", ";
			if (state.condenseFlow) pairBuffer += "\"";
			const objectKey = objectKeyList[index];
			let objectValue = object[objectKey];
			if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
			if (!writeNode(state, level, objectKey, false, false)) continue;
			if (state.dump.length > 1024) pairBuffer += "? ";
			pairBuffer += state.dump + (state.condenseFlow ? "\"" : "") + ":" + (state.condenseFlow ? "" : " ");
			if (!writeNode(state, level, objectValue, false, false)) continue;
			pairBuffer += state.dump;
			_result += pairBuffer;
		}
		state.tag = _tag;
		state.dump = "{" + _result + "}";
	}
	function writeBlockMapping(state, level, object, compact) {
		let _result = "";
		const _tag = state.tag;
		const objectKeyList = Object.keys(object);
		if (state.sortKeys === true) objectKeyList.sort();
		else if (typeof state.sortKeys === "function") objectKeyList.sort(state.sortKeys);
		else if (state.sortKeys) throw new YAMLException2("sortKeys must be a boolean or a function");
		for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
			let pairBuffer = "";
			if (!compact || _result !== "") pairBuffer += generateNextLine(state, level);
			const objectKey = objectKeyList[index];
			let objectValue = object[objectKey];
			if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
			if (!writeNode(state, level + 1, objectKey, true, true, true)) continue;
			const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
			if (explicitPair) if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += "?";
			else pairBuffer += "? ";
			pairBuffer += state.dump;
			if (explicitPair) pairBuffer += generateNextLine(state, level);
			if (!writeNode(state, level + 1, objectValue, true, explicitPair)) continue;
			if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += ":";
			else pairBuffer += ": ";
			pairBuffer += state.dump;
			_result += pairBuffer;
		}
		state.tag = _tag;
		state.dump = _result || "{}";
	}
	function detectType(state, object, explicit) {
		const typeList = explicit ? state.explicitTypes : state.implicitTypes;
		for (let index = 0, length = typeList.length; index < length; index += 1) {
			const type2 = typeList[index];
			if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
				if (explicit) if (type2.multi && type2.representName) state.tag = type2.representName(object);
				else state.tag = type2.tag;
				else state.tag = "?";
				if (type2.represent) {
					const style = state.styleMap[type2.tag] || type2.defaultStyle;
					let _result;
					if (_toString.call(type2.represent) === "[object Function]") _result = type2.represent(object, style);
					else if (_hasOwnProperty.call(type2.represent, style)) _result = type2.represent[style](object, style);
					else throw new YAMLException2("!<" + type2.tag + "> tag resolver accepts not \"" + style + "\" style");
					state.dump = _result;
				}
				return true;
			}
		}
		return false;
	}
	function writeNode(state, level, object, block, compact, iskey, isblockseq) {
		state.tag = null;
		state.dump = object;
		if (!detectType(state, object, false)) detectType(state, object, true);
		const type2 = _toString.call(state.dump);
		const inblock = block;
		if (block) block = state.flowLevel < 0 || state.flowLevel > level;
		const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
		let duplicateIndex;
		let duplicate;
		if (objectOrArray) {
			duplicateIndex = state.duplicates.indexOf(object);
			duplicate = duplicateIndex !== -1;
		}
		if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) compact = false;
		if (duplicate && state.usedDuplicates[duplicateIndex]) state.dump = "*ref_" + duplicateIndex;
		else {
			if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) state.usedDuplicates[duplicateIndex] = true;
			if (type2 === "[object Object]") if (block && Object.keys(state.dump).length !== 0) {
				writeBlockMapping(state, level, state.dump, compact);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
			} else {
				writeFlowMapping(state, level, state.dump);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
			}
			else if (type2 === "[object Array]") if (block && state.dump.length !== 0) {
				if (state.noArrayIndent && !isblockseq && level > 0) writeBlockSequence(state, level - 1, state.dump, compact);
				else writeBlockSequence(state, level, state.dump, compact);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
			} else {
				writeFlowSequence(state, level, state.dump);
				if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
			}
			else if (type2 === "[object String]") {
				if (state.tag !== "?") writeScalar(state, state.dump, level, iskey, inblock);
			} else if (type2 === "[object Undefined]") return false;
			else {
				if (state.skipInvalid) return false;
				throw new YAMLException2("unacceptable kind of an object to dump " + type2);
			}
			if (state.tag !== null && state.tag !== "?") {
				let tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
				if (state.tag[0] === "!") tagStr = "!" + tagStr;
				else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") tagStr = "!!" + tagStr.slice(18);
				else tagStr = "!<" + tagStr + ">";
				state.dump = tagStr + " " + state.dump;
			}
		}
		return true;
	}
	function getDuplicateReferences(object, state) {
		const objects = [];
		const duplicatesIndexes = [];
		inspectNode(object, objects, duplicatesIndexes);
		const length = duplicatesIndexes.length;
		for (let index = 0; index < length; index += 1) state.duplicates.push(objects[duplicatesIndexes[index]]);
		state.usedDuplicates = new Array(length);
	}
	function inspectNode(object, objects, duplicatesIndexes) {
		if (object !== null && typeof object === "object") {
			const index = objects.indexOf(object);
			if (index !== -1) {
				if (duplicatesIndexes.indexOf(index) === -1) duplicatesIndexes.push(index);
			} else {
				objects.push(object);
				if (Array.isArray(object)) for (let i = 0, length = object.length; i < length; i += 1) inspectNode(object[i], objects, duplicatesIndexes);
				else {
					const objectKeyList = Object.keys(object);
					for (let i = 0, length = objectKeyList.length; i < length; i += 1) inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
				}
			}
		}
	}
	function dump2(input, options) {
		options = options || {};
		const state = new State(options);
		if (!state.noRefs) getDuplicateReferences(input, state);
		let value = input;
		if (state.replacer) value = state.replacer.call({ "": value }, "", value);
		if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
		return "";
	}
	dumper.dump = dump2;
	return dumper;
}
var hasRequiredJsYaml;
function requireJsYaml() {
	if (hasRequiredJsYaml) return jsYaml;
	hasRequiredJsYaml = 1;
	const loader2 = requireLoader();
	const dumper2 = requireDumper();
	function renamed(from, to) {
		return function() {
			throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
		};
	}
	jsYaml.Type = requireType();
	jsYaml.Schema = requireSchema();
	jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
	jsYaml.JSON_SCHEMA = requireJson();
	jsYaml.CORE_SCHEMA = requireCore();
	jsYaml.DEFAULT_SCHEMA = require_default();
	jsYaml.load = loader2.load;
	jsYaml.loadAll = loader2.loadAll;
	jsYaml.dump = dumper2.dump;
	jsYaml.YAMLException = requireException();
	jsYaml.types = {
		binary: requireBinary(),
		float: requireFloat(),
		map: requireMap(),
		null: require_null(),
		pairs: requirePairs(),
		set: requireSet(),
		timestamp: requireTimestamp(),
		bool: requireBool(),
		int: requireInt(),
		merge: requireMerge(),
		omap: requireOmap(),
		seq: requireSeq(),
		str: requireStr()
	};
	jsYaml.safeLoad = renamed("safeLoad", "load");
	jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
	jsYaml.safeDump = renamed("safeDump", "dump");
	return jsYaml;
}
const yaml = /* @__PURE__ */ getDefaultExportFromCjs(requireJsYaml());
const { Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump } = yaml;
//#endregion
//#region src/errors.ts
/**
* Typed failures of the gateway. Each one carries the layer that owns the
* handling decision, so callers never string-match a message.
*/
/** A configuration document that violates the model or its cross-references. */
var ConfigError = class extends Error {
	name = "ConfigError";
};
/**
* An HTTP-level upstream failure. `status` is the upstream's status code so the
* MCP layer can rotate the key pool on 401/403/429 while still reporting the
* failure to the client.
*/
var UpstreamHttpError = class extends Error {
	name = "UpstreamHttpError";
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
	}
};
/** A JSON-RPC error answered by the upstream server itself. */
var UpstreamRpcError = class extends Error {
	name = "UpstreamRpcError";
};
/** A downstream argument that no configured transform accepts. */
var ParamError = class extends Error {
	name = "ParamError";
};
/** A transport-level failure that is not an HTTP status (reset, EOF, timeout). */
var UpstreamTransportError = class extends Error {
	name = "UpstreamTransportError";
};
//#endregion
//#region src/config.ts
/**
* Configuration loading, validation, and serialization for the gateway.
*
* A port of the retired service's `config.py`. Validation follows pydantic v2:
* unknown fields are ignored, model defaults are filled in, and a missing
* required field or a value of the wrong type raises {@link ConfigError}.
* `${VAR}` references are deliberately not resolved while parsing so the admin
* editor round-trips the literal text; transports resolve them when built.
*
* Owner: config-transform. Contract: DESIGN.md § src/config.ts.
*
* @module
*/
/** Toolset names that shadow a client built-in; see `Config.validate_toolsets`. */
const RESERVED_TOOLSETS = new Set(["fetch"]);
/** `${VAR}` reference; a bare `$VAR` is intentionally not matched. */
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** One backtick-quoted token from a description (`BACKTICK_REF` in the old model). */
const BACKTICK_REF$1 = /`(\S+)`/g;
/** Parent path of the YAML document root, used by the field-path helper. */
const ROOT = "";
/** Model defaults, kept next to their fields so a dump matches the old YAML. */
const DEFAULT_TRANSPORT = "http";
const DEFAULT_INHERIT_ENV$1 = ["PATH"];
const DEFAULT_CONNECT_TIMEOUT$1 = 30;
const DEFAULT_READ_TIMEOUT$2 = 120;
const DEFAULT_LIST_TIMEOUT = 20;
const DEFAULT_SERVER_NAME = "mcpp";
/**
* Join a parent path and a field name into the path used in error messages.
* @param parent - parent path, or the empty root path.
* @param field - field name.
* @returns the dotted path.
*/
function fieldPath(parent, field) {
	return parent === ROOT ? field : `${parent}.${field}`;
}
/**
* Narrow an unknown YAML value to a mapping.
* @param value - value to check.
* @returns whether it is a non-array object.
*/
function isMapping$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Require a mapping.
* @param value - value to check.
* @param path - path for the error message.
* @returns the mapping.
* @throws ConfigError when the value is not a mapping.
*/
function expectMapping(value, path) {
	if (!isMapping$1(value)) throw new ConfigError(`${path} must be a mapping`);
	return value;
}
/**
* Require a string.
* @param value - value to check.
* @param path - path for the error message.
* @returns the string.
* @throws ConfigError when the value is not a string.
*/
function expectString(value, path) {
	if (typeof value !== "string") throw new ConfigError(`${path} must be a string`);
	return value;
}
/**
* Require a key the document must provide.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns the field value.
* @throws ConfigError when the field is absent or not a string.
*/
function requireString(raw, field, parent) {
	const value = raw[field];
	if (value === void 0) throw new ConfigError(`${fieldPath(parent, field)} is required`);
	return expectString(value, fieldPath(parent, field));
}
/**
* Read an optional string field (`null` means absent, like `Optional[str]`).
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns the string, or undefined when the field is absent or null.
*/
function optionalString$1(raw, field, parent) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	return expectString(value, fieldPath(parent, field));
}
/**
* Read a string field that has a model default. An explicit `null` is a type
* error, not "use the default" — that is what pydantic does for `str = "…"`.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @param fallback - model default.
* @returns the configured string or the default.
*/
function defaultedString(raw, field, parent, fallback) {
	const value = raw[field];
	if (value === void 0) return fallback;
	return expectString(value, fieldPath(parent, field));
}
/**
* Read an optional boolean field.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns the boolean, or undefined when absent or null.
*/
function optionalBoolean$1(raw, field, parent) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "boolean") throw new ConfigError(`${fieldPath(parent, field)} must be a boolean`);
	return value;
}
/**
* Read a boolean field that has a model default.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @param fallback - model default.
* @returns the configured boolean or the default.
*/
function defaultedBoolean(raw, field, parent, fallback) {
	const value = raw[field];
	if (value === void 0) return fallback;
	if (typeof value !== "boolean") throw new ConfigError(`${fieldPath(parent, field)} must be a boolean`);
	return value;
}
/**
* Read an integer field that has a model default.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @param fallback - model default.
* @returns the configured integer or the default.
*/
function defaultedInteger(raw, field, parent, fallback) {
	const value = raw[field];
	if (value === void 0) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value)) throw new ConfigError(`${fieldPath(parent, field)} must be an integer`);
	return value;
}
/**
* Validate a YAML list of strings and copy it.
* @param value - value to validate.
* @param path - path for error messages.
* @returns a fresh string array.
*/
function stringList(value, path) {
	if (!Array.isArray(value)) throw new ConfigError(`${path} must be a list of strings`);
	return value.map((item, index) => expectString(item, `${path}[${index}]`));
}
/**
* Require a list-of-strings field.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns a fresh string array.
*/
function requireStringList(raw, field, parent) {
	const value = raw[field];
	const path = fieldPath(parent, field);
	if (value === void 0) throw new ConfigError(`${path} is required`);
	return stringList(value, path);
}
/**
* Read an optional list-of-strings field (`null` means absent).
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns the list, or undefined when absent or null.
*/
function optionalStringList(raw, field, parent) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	return stringList(value, fieldPath(parent, field));
}
/**
* Read a list-of-strings field that has a model default. The default is copied
* into a fresh array, matching `default_factory`.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @param fallback - model default.
* @returns the configured list or a copy of the default.
*/
function defaultedStringList(raw, field, parent, fallback) {
	const value = raw[field];
	if (value === void 0) return [...fallback];
	return stringList(value, fieldPath(parent, field));
}
/**
* Read an optional mapping field (`null` means absent).
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns the mapping, or undefined when absent or null.
*/
function optionalMapping(raw, field, parent) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	return expectMapping(value, fieldPath(parent, field));
}
/**
* Read an optional `dict[str, str]` field, e.g. a stdio upstream's `env`.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns a fresh string map, or undefined when absent or null.
*/
function optionalStringMap(raw, field, parent) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	const path = fieldPath(parent, field);
	const entries = Object.entries(expectMapping(value, path)).map(([name, item]) => [name, expectString(item, `${path}.${name}`)]);
	return Object.fromEntries(entries);
}
/**
* Read an optional `dict[str, dict[str, Any]]` field, e.g. a preset table.
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns a fresh preset map, or undefined when absent or null.
*/
function optionalPresetMap(raw, field, parent) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	const path = fieldPath(parent, field);
	const entries = Object.entries(expectMapping(value, path)).map(([name, preset]) => [name, expectMapping(preset, `${path}.${name}`)]);
	return Object.fromEntries(entries);
}
/**
* Read an upstream's `transport` field.
* @param raw - enclosing mapping.
* @param parent - parent path for error messages.
* @returns `http` (the default) or `stdio`.
*/
function readTransport(raw, parent) {
	const value = raw["transport"];
	if (value === void 0) return DEFAULT_TRANSPORT;
	if (value !== "http" && value !== "stdio") throw new ConfigError(`${fieldPath(parent, "transport")} must be "http" or "stdio"`);
	return value;
}
/**
* Read a parameter transform's `type` field.
* @param raw - enclosing mapping.
* @param parent - parent path for error messages.
* @returns `enum`, `preset`, or undefined for a passthrough parameter.
*/
function readParamType(raw, parent) {
	const value = raw["type"];
	if (value === void 0 || value === null) return void 0;
	if (value !== "enum" && value !== "preset") throw new ConfigError(`${fieldPath(parent, "type")} must be "enum" or "preset"`);
	return value;
}
/**
* Validate one `auth` block.
* @param value - raw YAML value.
* @param parent - path for error messages.
* @returns the auth configuration.
*/
function parseAuthConfig(value, parent) {
	const raw = expectMapping(value, parent);
	return {
		keys: requireStringList(raw, "keys", parent),
		header: requireString(raw, "header", parent),
		scheme: requireString(raw, "scheme", parent)
	};
}
/**
* Validate one upstream entry, applying model defaults.
* @param value - raw YAML value.
* @param parent - path for error messages.
* @returns the upstream configuration.
*/
function parseUpstreamConfig(value, parent) {
	const raw = expectMapping(value, parent);
	const name = requireString(raw, "name", parent);
	const transport = readTransport(raw, parent);
	const url = optionalString$1(raw, "url", parent);
	const command = optionalString$1(raw, "command", parent);
	const args = optionalStringList(raw, "args", parent);
	const env = optionalStringMap(raw, "env", parent);
	const inheritEnv = defaultedStringList(raw, "inherit_env", parent, DEFAULT_INHERIT_ENV$1);
	const rawAuth = raw["auth"];
	return {
		name,
		transport,
		url,
		command,
		args,
		env,
		inheritEnv,
		auth: rawAuth === void 0 || rawAuth === null ? void 0 : parseAuthConfig(rawAuth, fieldPath(parent, "auth")),
		connectTimeout: defaultedInteger(raw, "connect_timeout", parent, DEFAULT_CONNECT_TIMEOUT$1),
		readTimeout: defaultedInteger(raw, "read_timeout", parent, DEFAULT_READ_TIMEOUT$2),
		listTimeout: defaultedInteger(raw, "list_timeout", parent, DEFAULT_LIST_TIMEOUT)
	};
}
/**
* Validate one parameter transform, applying model defaults.
* @param value - raw YAML value.
* @param parent - path for error messages.
* @returns the parameter transform.
*/
function parseParamTransform(value, parent) {
	const raw = expectMapping(value, parent);
	return {
		name: requireString(raw, "name", parent),
		mapFrom: optionalString$1(raw, "map_from", parent),
		type: readParamType(raw, parent),
		mapping: optionalMapping(raw, "mapping", parent),
		preset: optionalPresetMap(raw, "preset", parent),
		hidden: defaultedBoolean(raw, "hidden", parent, false),
		default: raw["default"],
		description: optionalString$1(raw, "description", parent),
		required: optionalBoolean$1(raw, "required", parent)
	};
}
/**
* Validate an optional `params` list (`null` means "pass the upstream schema
* through", which is different from an empty list).
* @param raw - enclosing mapping.
* @param field - field name.
* @param parent - parent path for error messages.
* @returns the transforms, or undefined when absent or null.
*/
function optionalParams(raw, field, parent) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	const path = fieldPath(parent, field);
	if (!Array.isArray(value)) throw new ConfigError(`${path} must be a list`);
	return value.map((item, index) => parseParamTransform(item, `${path}[${index}]`));
}
/**
* Validate one expose entry, applying model defaults.
* @param value - raw YAML value.
* @param parent - path for error messages.
* @returns the expose entry.
*/
function parseExposeEntry(value, parent) {
	const raw = expectMapping(value, parent);
	return {
		upstream: requireString(raw, "upstream", parent),
		tool: requireString(raw, "tool", parent),
		as: optionalString$1(raw, "as", parent),
		toolset: optionalString$1(raw, "toolset", parent),
		hide: defaultedBoolean(raw, "hide", parent, false),
		description: optionalString$1(raw, "description", parent),
		params: optionalParams(raw, "params", parent)
	};
}
/**
* Validate the `expose` table.
* @param value - raw YAML value.
* @param parent - path for error messages.
* @returns the keyed expose table.
*/
function parseExposeTable(value, parent) {
	if (value === void 0) throw new ConfigError(`${parent} is required`);
	const raw = expectMapping(value, parent);
	const entries = Object.entries(raw).map(([key, entry]) => [key, parseExposeEntry(entry, `${parent}.${key}`)]);
	return Object.fromEntries(entries);
}
/**
* Validate the gateway-level `auth` block.
* @param value - raw YAML value.
* @param parent - path for error messages.
* @returns the auth settings.
*/
function parseGatewayAuth(value, parent) {
	return { token: optionalString$1(expectMapping(value, parent), "token", parent) };
}
/**
* Validate the per-client endpoint enable map.
* @param value - raw YAML value.
* @param parent - path for error messages.
* @returns client id to enabled flag.
*/
function parseClients(value, parent) {
	const raw = expectMapping(value, parent);
	const entries = Object.entries(raw).map(([id, enabled]) => {
		if (typeof enabled !== "boolean") throw new ConfigError(`${parent}.${id} must be a boolean`);
		return [id, enabled];
	});
	return Object.fromEntries(entries);
}
/**
* Reject descriptions that reference a tool missing from `expose` or hidden.
* Only slash-bearing `` `upstream/tool` `` refs are cross-tool references; other
* backtick-quoted tokens are literals (param names, code fragments).
* @param config - configuration to check.
* @throws ConfigError on the first dangling or hidden reference.
*/
function validateRefs(config) {
	for (const [key, entry] of Object.entries(config.expose)) {
		const description = entry.description;
		if (description === void 0 || description === null || description === "") continue;
		for (const match of description.matchAll(BACKTICK_REF$1)) {
			const ref = match[1];
			if (!ref.includes("/")) continue;
			const target = config.expose[ref];
			if (target === void 0) throw new ConfigError(`Tool '${key}' description references '${ref}', which does not exist in expose`);
			if (target.hide) throw new ConfigError(`Tool '${key}' description references '${ref}', which is hidden (hide: true)`);
		}
	}
}
/**
* Reject aggregated toolset names that shadow a client built-in.
* @param config - configuration to check.
* @throws ConfigError when an entry resolves to a reserved toolset name.
*/
function validateToolsets(config) {
	for (const [key, entry] of Object.entries(config.expose)) {
		const name = entry.toolset ?? config.serverName;
		if (!RESERVED_TOOLSETS.has(name)) continue;
		throw new ConfigError(`Tool '${key}' uses toolset '${name}', which is reserved: clients expand it to mcp__${name}__<tool> and already ship a built-in of that name. Use a distinct toolset name (e.g. 'get').`);
	}
}
/**
* Render one upstream as the YAML field order of the old model, dropping
* undefined fields (`exclude_none=True, by_alias=True`).
* @param upstream - upstream configuration.
* @returns the ordered plain object to serialize.
*/
function plainUpstream(upstream) {
	const out = {
		name: upstream.name,
		transport: upstream.transport
	};
	if (upstream.url !== void 0 && upstream.url !== null) out["url"] = upstream.url;
	if (upstream.command !== void 0 && upstream.command !== null) out["command"] = upstream.command;
	if (upstream.args !== void 0 && upstream.args !== null) out["args"] = [...upstream.args];
	if (upstream.env !== void 0 && upstream.env !== null) out["env"] = { ...upstream.env };
	out["inherit_env"] = [...upstream.inheritEnv];
	if (upstream.auth !== void 0 && upstream.auth !== null) out["auth"] = {
		keys: [...upstream.auth.keys],
		header: upstream.auth.header,
		scheme: upstream.auth.scheme
	};
	out["connect_timeout"] = upstream.connectTimeout;
	out["read_timeout"] = upstream.readTimeout;
	out["list_timeout"] = upstream.listTimeout;
	return out;
}
/**
* Render one parameter transform in the YAML field order of the old model.
* @param param - parameter transform.
* @returns the ordered plain object to serialize.
*/
function plainParamTransform(param) {
	const out = { name: param.name };
	if (param.mapFrom !== void 0 && param.mapFrom !== null) out["map_from"] = param.mapFrom;
	if (param.type !== void 0 && param.type !== null) out["type"] = param.type;
	if (param.mapping !== void 0 && param.mapping !== null) out["mapping"] = { ...param.mapping };
	if (param.preset !== void 0 && param.preset !== null) out["preset"] = { ...param.preset };
	out["hidden"] = param.hidden;
	if (param.default !== void 0 && param.default !== null) out["default"] = param.default;
	if (param.description !== void 0 && param.description !== null) out["description"] = param.description;
	if (param.required !== void 0 && param.required !== null) out["required"] = param.required;
	return out;
}
/**
* Render one expose entry in the YAML field order of the old model.
* @param entry - expose entry.
* @returns the ordered plain object to serialize.
*/
function plainExposeEntry(entry) {
	const out = {
		upstream: entry.upstream,
		tool: entry.tool
	};
	if (entry.as !== void 0 && entry.as !== null) out["as"] = entry.as;
	if (entry.toolset !== void 0 && entry.toolset !== null) out["toolset"] = entry.toolset;
	out["hide"] = entry.hide;
	if (entry.description !== void 0 && entry.description !== null) out["description"] = entry.description;
	if (entry.params !== void 0) out["params"] = entry.params.map(plainParamTransform);
	return out;
}
/**
* Render the whole configuration in the YAML field order of the old model.
* @param config - configuration to serialize.
* @returns the ordered plain object to serialize.
*/
function plainConfig(config) {
	const out = {
		upstreams: config.upstreams.map(plainUpstream),
		expose: Object.fromEntries(Object.entries(config.expose).map(([key, entry]) => [key, plainExposeEntry(entry)])),
		server_name: config.serverName
	};
	if (config.auth !== void 0 && config.auth !== null) {
		const auth = {};
		if (config.auth.token !== void 0 && config.auth.token !== null) auth["token"] = config.auth.token;
		out["auth"] = auth;
	}
	if (config.clients !== void 0 && config.clients !== null) out["clients"] = { ...config.clients };
	return out;
}
/**
* Format an unknown thrown value for a wrapped ConfigError message.
* @param cause - thrown value.
* @returns its message.
*/
function errorMessage(cause) {
	return cause instanceof Error ? cause.message : String(cause);
}
/**
* Parse and validate a whole `config.yaml` document.
*
* Unknown fields are ignored (pydantic's default `extra='ignore'`).
* @param text - YAML source.
* @param env - accepted for call-site symmetry with {@link resolveEnvValue};
*   parsing never resolves `${VAR}`, so dumps round-trip the literal text.
* @returns the validated configuration with model defaults applied.
* @throws ConfigError when the document violates the model or its cross-references.
*/
function parseConfig(text, env = process.env) {
	let document;
	try {
		document = yaml.load(text);
	} catch (cause) {
		throw new ConfigError(`invalid YAML: ${errorMessage(cause)}`);
	}
	const raw = expectMapping(document, "configuration");
	const rawUpstreams = raw["upstreams"];
	if (rawUpstreams === void 0) throw new ConfigError("upstreams is required");
	if (!Array.isArray(rawUpstreams)) throw new ConfigError("upstreams must be a list");
	const upstreams = rawUpstreams.map((item, index) => parseUpstreamConfig(item, `upstreams[${index}]`));
	const expose = parseExposeTable(raw["expose"], "expose");
	const serverName = defaultedString(raw, "server_name", ROOT, DEFAULT_SERVER_NAME);
	const rawAuth = raw["auth"];
	const auth = rawAuth === void 0 || rawAuth === null ? void 0 : parseGatewayAuth(rawAuth, "auth");
	const rawClients = raw["clients"];
	const config = {
		upstreams,
		expose,
		serverName,
		auth,
		clients: rawClients === void 0 || rawClients === null ? void 0 : parseClients(rawClients, "clients")
	};
	validateRefs(config);
	validateToolsets(config);
	return config;
}
/**
* Read, parse, and validate the configuration file.
* @param path - absolute or cwd-relative YAML path.
* @param env - environment for call-site symmetry; see {@link parseConfig}.
* @returns the validated configuration.
* @throws ConfigError when the file cannot be read or does not validate.
*/
function loadConfigFile(path, env = process.env) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (cause) {
		throw new ConfigError(`cannot read config file '${path}': ${errorMessage(cause)}`);
	}
	return parseConfig(text, env);
}
/**
* Serialize a configuration back to YAML for the admin editor and reload path.
*
* Equivalent to the old `to_yaml()`: model field order, aliases (`as`,
* `map_from`, `inherit_env`, `*_timeout`, `server_name`), undefined/null fields
* dropped, unicode kept verbatim, no line wrapping.
* @param config - configuration to serialize.
* @returns YAML text.
*/
function dumpConfig(config) {
	return yaml.dump(plainConfig(config), {
		lineWidth: -1,
		noRefs: true,
		sortKeys: false
	});
}
/**
* Resolve `${VAR}` references against the environment; unknown names become an
* empty string. Values without references come back unchanged.
* @param value - raw configured string.
* @param env - environment to read; defaults to `process.env`.
* @returns the resolved string.
*/
function resolveEnvValue(value, env = process.env) {
	return value.replace(ENV_REF, (_match, name) => env[name] ?? "");
}
//#endregion
//#region src/keypool.ts
/** Hidden-key prefix length reported by {@link KeyPool.statuses}. */
const MASK_PREFIX = 4;
/**
* Keys are handed out round-robin. A key marked bad is skipped until resumed;
* when every key is paused {@link next} throws so the caller surfaces an
* explicit "no healthy keys" failure instead of sending an empty credential.
*/
var KeyPool = class {
	keys;
	bad = /* @__PURE__ */ new Set();
	index = 0;
	/**
	* @param keys - at least one key; the pool keeps its own copy.
	* @throws Error when `keys` is empty.
	*/
	constructor(keys) {
		if (keys.length === 0) throw new Error("Pool requires at least one key");
		this.keys = [...keys];
	}
	/**
	* Next healthy key in round-robin order, shared by every caller.
	* @returns the key to send.
	* @throws Error when every key is paused.
	*/
	next() {
		for (let attempt = 0; attempt < this.keys.length; attempt += 1) {
			const key = this.keys[this.index];
			this.index = (this.index + 1) % this.keys.length;
			if (!this.bad.has(key)) return key;
		}
		throw new Error("No healthy keys available in pool");
	}
	/**
	* Pause one key until it is resumed explicitly.
	* @param key - key that failed; an unknown key is recorded like the old service did.
	*/
	markBad(key) {
		this.bad.add(key);
	}
	/**
	* Return one paused key to rotation.
	* @param key - key to resume; resuming an unknown or healthy key is a no-op.
	*/
	resume(key) {
		this.bad.delete(key);
	}
	/** How many keys are currently usable. */
	get healthyCount() {
		return this.keys.length - this.bad.size;
	}
	/**
	* Masked key statuses for the admin API.
	* @returns one status per key, in pool order.
	*/
	statuses() {
		return this.keys.map((key, index) => ({
			index,
			key: key.slice(0, MASK_PREFIX) + "...",
			paused: this.bad.has(key)
		}));
	}
	/**
	* Key at a raw index, for admin resume/delete operations.
	* @param index - zero-based index; negative indexes count from the end.
	* @returns the raw (unmasked) key.
	* @throws RangeError when the index falls outside the pool.
	*/
	keyAt(index) {
		const resolved = index < 0 ? index + this.keys.length : index;
		if (resolved < 0 || resolved >= this.keys.length) throw new RangeError(`Key index ${index} out of range for a pool of ${this.keys.length}`);
		return this.keys[resolved];
	}
	/** The most recently returned key (used to mark a failed request's key bad). */
	get current() {
		const previous = (this.index - 1 + this.keys.length) % this.keys.length;
		return this.keys[previous];
	}
};
//#endregion
//#region src/logger.ts
/** Write one line to stderr with a level tag (the retired service's format). */
function toStderr(level, message) {
	process.stderr.write(`${level} [mcpp] ${message}\n`);
}
/**
* Build a logger writing to stderr, the retired service's destination.
* @param label - optional prefix appended after `[mcpp]`.
* @returns the logger.
*/
function createLogger(label = "") {
	const suffix = label === "" ? "" : ` (${label})`;
	return {
		info: (message) => {
			toStderr("INFO", message + suffix);
		},
		warn: (message) => {
			toStderr("WARNING", message + suffix);
		},
		error: (message) => {
			toStderr("ERROR", message + suffix);
		}
	};
}
//#endregion
//#region src/presets.ts
/**
* Template-driven naming strategy: `{server}`/`{tool}` are the only
* placeholders, everything else is literal. The inverse regex makes
* `{server}` non-greedy and `{tool}` greedy, which round-trips as long as the
* separator characters do not appear inside tool names.
*/
var TemplateFormat = class {
	namingId;
	format;
	pattern;
	/**
	* @param namingId - catalogue id, also the endpoint path segment.
	* @param format - template such as `mcp__{server}__{tool}`.
	*/
	constructor(namingId, format) {
		this.namingId = namingId;
		this.format = format;
		let source = "^";
		for (const part of format.split(/(\{server\}|\{tool\})/)) if (part === "{server}") source += "(?<server>.+?)";
		else if (part === "{tool}") source += "(?<tool>.+)";
		else source += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		this.pattern = new RegExp(source + "$");
	}
	/** Expand the template with the server and tool-name segments. */
	formatName(server, displayName) {
		return this.format.replace("{server}", server).replace("{tool}", displayName);
	}
	/** Recover the tool segment when the formatted name belongs to `server`. */
	parseName(server, formatted) {
		const match = this.pattern.exec(formatted);
		if (match === null) return null;
		if (match.groups?.["server"] !== server) return null;
		const tool = match.groups?.["tool"];
		return tool === void 0 || tool === "" ? null : tool;
	}
};
/**
* Raw passthrough: the client-visible name is the expose display name. Kept
* distinct from a `{tool}` template because that template would match any
* string on parse, which is not what the default mode means.
*/
var DefaultFormat = class {
	namingId = "default";
	/** The display name is already the client-visible name. */
	formatName(_server, displayName) {
		return displayName;
	}
	/** Always defer to the caller's key/display-name fallback. */
	parseName(_server, _formatted) {
		return null;
	}
};
/** Naming-mode catalogue; `default` is handled by {@link DefaultFormat}. */
const NAMING_MODES = {
	claude: {
		format: "mcp__{server}__{tool}",
		sample: "mcp__search__papers"
	},
	cursor: {
		format: "mcp_{server}_{tool}",
		sample: "mcp_search_papers"
	},
	opencode: {
		format: "{server}_{tool}",
		sample: "search_papers"
	},
	coder: {
		format: "{server}__{tool}",
		sample: "search__papers"
	},
	codex: {
		format: "{server}::{tool}",
		sample: "search::papers"
	},
	default: {
		format: "{tool}",
		sample: "papers"
	}
};
/** Connection-preset templates the admin UI renders for each client. */
const CONNECT_MODES = {
	claude: {
		file: "~/.claude.json 或 claude_desktop_config.json",
		template: `{
  "mcpServers": {
    "{toolset}": {
      "type": "http",
      "url": "{endpoint}"{token_header}
    }
  }
}
`
	},
	cursor: {
		file: "~/.cursor/mcp.json",
		template: `{
  "mcpServers": {
    "{toolset}": {
      "url": "{endpoint}",
      "transport": { "type": "streamableHttp" }{token_header}
    }
  }
}
`
	},
	opencode: {
		file: "opencode.json 或 ~/.config/opencode/opencode.json",
		template: `{
  "mcp": {
    "{toolset}": {
      "type": "remote",
      "url": "{endpoint}"{token_header}
    }
  }
}
`
	},
	codex: {
		file: "~/.codex/config.toml",
		template: `[mcp_servers.{toolset}]
url = "{endpoint}"
# put the token in an env var, then reference it:
bearer_token_env_var = "MCP_TOKEN"
`
	},
	hermes: {
		file: "~/.hermes/config.yaml",
		template: `mcp_servers:
  {toolset}:
    url: "{endpoint}"
    headers:
      Authorization: "Bearer {token}"
`
	},
	openclaw: {
		file: "~/.openclaw/openclaw.json",
		template: `{
  "mcp": {
    "servers": {
      "{toolset}": {
        "url": "{endpoint}",
        "transport": "streamable-http"{token_header}
      }
    }
  }
}
`
	}
};
/**
* Client catalogue: each client picks one naming mode and one connect mode.
* Comments from the YAML carry over as `note` so the admin payload stays
* self-describing.
*/
const CLIENT_PRESETS = {
	"claude-code": {
		naming: "claude",
		connect: "claude"
	},
	"claude-desktop": {
		naming: "claude",
		connect: "claude"
	},
	cursor: {
		naming: "cursor",
		connect: "cursor"
	},
	opencode: {
		naming: "opencode",
		connect: "opencode"
	},
	reasonix: {
		naming: "claude",
		connect: "codex",
		note: "claude-like naming, TOML connect"
	},
	coder: {
		naming: "coder",
		connect: "claude",
		note: "serverName__toolName"
	},
	trae: {
		naming: "cursor",
		connect: "claude",
		note: "naming unverified; cursor-like assumed"
	},
	codex: {
		naming: "codex",
		connect: "codex",
		note: "namespace+name pair; :: stand-in"
	},
	hermes: {
		naming: "cursor",
		connect: "hermes"
	},
	pi: {
		naming: "opencode",
		connect: "claude"
	},
	workbuddy: {
		naming: "claude",
		connect: "claude"
	},
	openclaw: {
		naming: "coder",
		connect: "openclaw"
	}
};
/** Format registry: `default` plus one template strategy per other mode. */
const FORMAT_REGISTRY = (() => {
	const registry = { default: new DefaultFormat() };
	for (const [id, mode] of Object.entries(NAMING_MODES)) {
		if (id === "default") continue;
		registry[id] = new TemplateFormat(id, mode.format);
	}
	return registry;
})();
/** Endpoint path per naming mode; the `{toolset}` placeholder is resolved by the router. */
const CLIENT_ROUTES = Object.fromEntries(Object.keys(FORMAT_REGISTRY).map((id) => [id, `/{toolset}/${id}/mcp`]));
/**
* Resolve a naming mode, falling back to the default strategy.
* @param namingId - path segment from the request.
* @returns the strategy (never undefined).
*/
function getFormat(namingId) {
	return FORMAT_REGISTRY[namingId] ?? FORMAT_REGISTRY["default"];
}
/**
* The raw preset catalogue in the shape `/api/client-presets` returns.
*
* Notes are code comments, not payload: the retired service's clients section
* carried only `naming` and `connect`, so the response must too.
* @returns naming modes (with endpoint paths), connect modes, and clients.
*/
function presets() {
	const namingModes = {};
	for (const [id, mode] of Object.entries(NAMING_MODES)) namingModes[id] = {
		format: mode.format,
		sample: mode.sample,
		endpoint_path: CLIENT_ROUTES[id]
	};
	const clients = {};
	for (const [id, entry] of Object.entries(CLIENT_PRESETS)) clients[id] = {
		naming: entry.naming,
		connect: entry.connect
	};
	return {
		naming_modes: namingModes,
		connect_modes: CONNECT_MODES,
		clients
	};
}
/** Naming modes served at `/{toolset}/{naming}/mcp`, in catalogue order. */
const NAMING_IDS = Object.keys(FORMAT_REGISTRY);
//#endregion
//#region src/transform.ts
/**
* Downstream tool-surface transformation: display names, description
* cross-references, input schemas, and argument mapping back to upstream
* parameter names.
*
* Ported from the retired service's `transform.py`.
*
* Owner: config-transform. Contract: DESIGN.md § src/transform.ts.
*
* @module
*/
/** One backtick-quoted token from a description (`BACKTICK_REF` in the old model). */
const BACKTICK_REF = /`(\S+)`/g;
/**
* Narrow a JSON value to an object.
* @param value - value to check.
* @returns whether it is a non-array object.
*/
function isMapping(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Whether a map has at least one key (a truthiness check on the old models).
* @param map - map to inspect; absent maps are falsy.
* @returns whether the map is present and non-empty.
*/
function hasKeys(map) {
	return map !== void 0 && map !== null && Object.keys(map).length > 0;
}
/**
* Format a rejected downstream value the way the old service's f-string did.
* @param value - value the client sent.
* @returns a bare rendering of the value.
*/
function renderValue(value) {
	return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
}
/**
* Format an allowed-value list the way Python's `list(dict)` repr did.
* @param values - allowed keys, in configured order.
* @returns the bracketed, quoted list.
*/
function renderAllowed(values) {
	return `[${values.map((value) => `'${value}'`).join(", ")}]`;
}
/**
* Display name of one expose entry: `as` when set, else the key's last segment.
* @param entry - expose entry.
* @param key - stable `upstream/tool` key.
* @returns the downstream display name.
*/
function displayName(entry, key) {
	return entry.as ?? key.slice(key.lastIndexOf("/") + 1);
}
/**
* Build the downstream input schema for one expose entry.
*
* With `params === undefined` the upstream schema passes through unchanged.
* Otherwise every visible transform contributes a property: the build starts
* from a copy of the upstream property so constraints (enum, format, items,
* minimum, …) survive; `type: enum`/`type: preset` replace `type` and `enum`.
* A param with an explicit `required` overrides upstream optionality, otherwise
* optionality is inherited from the upstream `required` list.
* @param entry - expose entry carrying the transforms.
* @param upstreamSchema - raw upstream `inputSchema`.
* @returns the downstream schema, or undefined when both are absent.
*/
function buildDownstreamSchema(entry, upstreamSchema) {
	if (entry.params === void 0) return upstreamSchema;
	const upstream = upstreamSchema ?? {};
	const upstreamProps = isMapping(upstream["properties"]) ? upstream["properties"] : {};
	const upstreamRequiredRaw = upstream["required"];
	const upstreamRequired = Array.isArray(upstreamRequiredRaw) ? upstreamRequiredRaw.filter((name) => typeof name === "string") : [];
	const properties = {};
	const required = [];
	for (const param of entry.params) {
		if (param.hidden) continue;
		const upstreamName = param.mapFrom ?? param.name;
		const candidate = upstreamProps[upstreamName];
		const upstreamParam = isMapping(candidate) ? candidate : {};
		const prop = Object.keys(upstreamParam).length === 0 ? { type: "string" } : { ...upstreamParam };
		const description = param.description || readDescription(upstreamParam);
		if (description) prop["description"] = description;
		const enumKeys = param.mapping === void 0 || param.mapping === null ? [] : Object.keys(param.mapping);
		const presetKeys = param.preset === void 0 || param.preset === null ? [] : Object.keys(param.preset);
		if (param.type === "enum" && enumKeys.length > 0) {
			prop["type"] = "string";
			prop["enum"] = enumKeys;
		} else if (param.type === "preset" && presetKeys.length > 0) {
			prop["type"] = "string";
			prop["enum"] = presetKeys;
		}
		properties[param.name] = prop;
		if (param.required ?? upstreamRequired.includes(upstreamName)) required.push(param.name);
	}
	const schema = {
		type: "object",
		properties
	};
	if (required.length > 0) schema["required"] = required;
	return schema;
}
/**
* Read an upstream property's description when it is a string.
* @param upstreamParam - upstream property schema.
* @returns the description, or an empty string.
*/
function readDescription(upstreamParam) {
	const description = upstreamParam["description"];
	return typeof description === "string" ? description : "";
}
/**
* Map downstream arguments back to upstream parameter names.
*
* Hidden params inject their `default` upstream; omitted (undefined/null)
* values are not sent so the upstream default applies; enum/preset values are
* checked against the configured whitelist.
* @param rawArgs - arguments exactly as the client sent them.
* @param entry - expose entry carrying the transforms.
* @returns upstream arguments.
* @throws ParamError when an enum/preset value is not in the configured whitelist.
*/
function paramTransformValue(rawArgs, entry) {
	if (entry.params === void 0) return rawArgs;
	const upstream = {};
	for (const param of entry.params) {
		const upstreamName = param.mapFrom ?? param.name;
		if (param.hidden) {
			if (param.default !== void 0 && param.default !== null) upstream[upstreamName] = param.default;
			continue;
		}
		const value = rawArgs[param.name];
		if (value === void 0 || value === null) continue;
		const mapping = param.mapping;
		const preset = param.preset;
		if (param.type === "enum" && hasKeys(mapping)) if (typeof value === "string" && Object.hasOwn(mapping, value)) upstream[upstreamName] = mapping[value];
		else throw new ParamError(`Invalid value '${renderValue(value)}' for enum param '${param.name}'. Valid: ${renderAllowed(Object.keys(mapping))}`);
		else if (param.type === "preset" && hasKeys(preset)) if (typeof value === "string" && Object.hasOwn(preset, value)) Object.assign(upstream, preset[value]);
		else throw new ParamError(`Invalid value '${renderValue(value)}' for preset param '${param.name}'. Valid: ${renderAllowed(Object.keys(preset))}`);
		else upstream[upstreamName] = value;
	}
	return upstream;
}
/**
* Expand `` `upstream/tool` `` backtick refs to the name the client sees.
*
* Each ref expands through the same per-client naming format as the tool's own
* name; refs that do not name an expose key are left verbatim.
* @param description - description text.
* @param refs - stable key to `[toolset, display name]`.
* @param format - naming strategy for the client.
* @returns the description with refs expanded.
*/
function resolveBackticks(description, refs, format) {
	return description.replace(BACKTICK_REF, (match, ref) => {
		const hit = refs.get(ref);
		if (hit === void 0) return match;
		return `\`${format.formatName(hit[0], hit[1])}\``;
	});
}
/**
* Composite map key for one `(upstream, tool)` pair.
* @param upstreamName - upstream name.
* @param toolName - upstream tool name.
* @returns the composite key.
*/
function upstreamToolKey(upstreamName, toolName) {
	return `${upstreamName}\u0000${toolName}`;
}
/**
* Transform one upstream's raw tools into the downstream surface for one
* client naming mode and one toolset.
*
* Tools whose `(upstream, tool)` pair is not exposed, or whose entry is hidden,
* are dropped; `toolset` filters to one aggregated server. Only `name`,
* `description`, and `inputSchema` are emitted, as the old service did.
* @param upstreamName - upstream these tools came from.
* @param tools - raw upstream tools.
* @param config - gateway configuration (expose table, server name).
* @param client - naming mode id; defaults to `default`.
* @param toolset - when set, keep only tools of that aggregated server.
* @returns transformed tools in upstream order.
*/
function transformTools(upstreamName, tools, config, client = "default", toolset) {
	const byUpstreamTool = /* @__PURE__ */ new Map();
	const displayNames = /* @__PURE__ */ new Map();
	const refs = /* @__PURE__ */ new Map();
	for (const [key, entry] of Object.entries(config.expose)) {
		const name = displayName(entry, key);
		byUpstreamTool.set(upstreamToolKey(entry.upstream, entry.tool), [key, entry]);
		displayNames.set(key, name);
		refs.set(key, [entry.toolset ?? config.serverName, name]);
	}
	const format = getFormat(client);
	const result = [];
	for (const tool of tools) {
		const lookup = byUpstreamTool.get(upstreamToolKey(upstreamName, tool.name));
		if (lookup === void 0) continue;
		const [key, entry] = lookup;
		if (entry.hide) continue;
		const resolvedToolset = entry.toolset ?? config.serverName;
		if (toolset !== void 0 && resolvedToolset !== toolset) continue;
		const name = displayNames.get(key) ?? tool.name;
		const description = resolveBackticks(entry.description ?? tool.description ?? "", refs, format);
		const inputSchema = buildDownstreamSchema(entry, tool.inputSchema);
		result.push({
			name: format.formatName(resolvedToolset, name),
			description,
			inputSchema
		});
	}
	return result;
}
//#endregion
//#region src/types.ts
/**
* Shared vocabulary of the mcpp gateway: the YAML configuration model, the
* upstream transport seam, and the dependency objects the HTTP layers receive.
*
* Field names mirror the Python implementation's model (pydantic aliases) so a
* config.yaml written by either side round-trips: `as`, `map_from`, `hide`,
* `inherit_env`, `connect_timeout`, `read_timeout`, `list_timeout`.
*
* @module
*/
/** MCP protocol revision this gateway advertises, matching the retired service. */
const PROTOCOL_VERSION = "2025-11-25";
/** Version string reported in `serverInfo` and the admin API. */
const SERVER_VERSION = "0.1.0";
/** Bridge auth cookie name and lifetime (seconds). */
const AUTH_COOKIE_NAME = "mcpp_token";
const AUTH_COOKIE_MAX_AGE = 720 * 3600;
//#endregion
//#region src/gateway.ts
/**
* MCP protocol layer: one JSON-RPC request in, one HTTP reply out, for one
* (toolset, naming mode) endpoint.
*
* Owner: gateway-admin. Contract: DESIGN.md § src/gateway.ts and the retired
* service's `main.py:35-85,417-679`.
*
* The endpoint is stateless: every request re-reads the live configuration and
* the live transport map, so an admin reload is visible to the next call
* without any session bookkeeping.
*
* @module
*/
/**
* Timeout marker for one upstream's `tools/list`. Kept distinct from transport
* errors so the log line can say "timed out" instead of echoing a raw abort.
*/
var ListTimeoutError$1 = class extends Error {
	name = "ListTimeoutError";
};
/**
* Narrow an unknown JSON value to a plain object.
* @param value - candidate.
* @returns whether the value is a non-null, non-array object.
*/
function isJsonObject$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Render an unknown thrown value as a message.
* @param error - thrown value.
* @returns the message, or the stringified value.
*/
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Race a promise against a timeout.
* @param promise - the operation to cap.
* @param timeoutMs - cap in milliseconds.
* @returns the operation's value.
* @throws ListTimeoutError when the cap expires first; otherwise the
* operation's own rejection.
*/
function withListTimeout(promise, timeoutMs) {
	let timer;
	const timeout = new Promise((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new ListTimeoutError$1());
		}, timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== void 0) clearTimeout(timer);
	});
}
/** One JSON-RPC success answer. */
function rpcResult(id, result) {
	return {
		status: 200,
		body: {
			jsonrpc: "2.0",
			id,
			result
		}
	};
}
/** One JSON-RPC error answer. */
function rpcError(id, code, message) {
	return {
		status: 200,
		body: {
			jsonrpc: "2.0",
			id,
			error: {
				code,
				message
			}
		}
	};
}
/** Current wall-clock time in seconds, the unit `/api/calls` and the UI expect. */
function nowSeconds() {
	return Date.now() / 1e3;
}
/**
* Every toolset name used by the expose table, plus the default server name.
* @param config - gateway configuration.
* @returns the set of known toolset names.
*/
function knownToolsets(config) {
	const names = /* @__PURE__ */ new Set();
	for (const entry of Object.values(config.expose)) names.add(entry.toolset ?? config.serverName);
	names.add(config.serverName);
	return names;
}
/**
* Normalize a URL toolset segment to a real toolset name.
* @param config - gateway configuration.
* @param toolset - raw segment; the literal `mcpp` maps to the default server.
* @returns the resolved name, or null when unknown.
*/
function resolveToolset(config, toolset) {
	if (knownToolsets(config).has(toolset)) return toolset;
	if (toolset === "mcpp") return config.serverName;
	return null;
}
/**
* Fetch one upstream's tools with a list timeout, transform them, and swallow
* per-upstream failures into an empty list plus a warning.
* @param deps - handler dependencies.
* @param config - gateway configuration.
* @param upstreamName - upstream to fetch.
* @param client - naming mode.
* @param toolset - aggregated server filter, or undefined for all.
* @param listTimeout - per-upstream cap in seconds.
* @returns transformed tools, or `[]` when the upstream failed or timed out.
*/
async function fetchTools(deps, config, upstreamName, client, toolset, listTimeout) {
	const transport = deps.transport(upstreamName);
	if (transport === void 0) return [];
	try {
		return transformTools(upstreamName, await withListTimeout(transport.listTools(), listTimeout * 1e3), config, client, toolset);
	} catch (error) {
		if (error instanceof ListTimeoutError$1) deps.logger.warn(`Upstream '${upstreamName}' tools/list timed out after ${listTimeout}s, skipped`);
		else deps.logger.warn(`Upstream '${upstreamName}' failed: ${messageOf$1(error)}`);
		return [];
	}
}
/**
* Fetch and transform tools from every configured upstream concurrently.
* @param deps - handler dependencies.
* @param config - gateway configuration.
* @param client - naming mode id.
* @param toolset - aggregated server filter, or undefined for all.
* @returns concatenated tools in configuration order.
*/
async function fetchAllTools(deps, config, client = "default", toolset) {
	return (await Promise.all(config.upstreams.map(async (upstream) => fetchTools(deps, config, upstream.name, client, toolset, upstream.listTimeout)))).flat();
}
/**
* Find the expose entry a client-visible or stable name refers to.
* @param config - gateway configuration.
* @param nameOrKey - client-formatted name, display name, or stable key.
* @param client - naming mode id.
* @param toolset - aggregated server filter, or undefined for any.
* @returns the entry and its upstream name, or null when nothing matches.
*/
function findExposeEntry(config, nameOrKey, client, toolset) {
	const inToolset = (entry) => toolset === void 0 || (entry.toolset ?? config.serverName) === toolset;
	if (client !== "default") {
		const format = getFormat(client);
		let display = format.parseName(toolset ?? config.serverName, nameOrKey);
		if (display === null && toolset !== void 0 && toolset !== config.serverName) display = format.parseName(config.serverName, nameOrKey);
		if (display !== null) for (const [key, entry] of Object.entries(config.expose)) {
			if (entry.hide || !inToolset(entry)) continue;
			if (displayName(entry, key) === display) return {
				entry,
				upstreamName: key.split("/")[0] ?? ""
			};
		}
	}
	for (const [key, entry] of Object.entries(config.expose)) {
		if (entry.hide || !inToolset(entry)) continue;
		if (nameOrKey === key || nameOrKey === displayName(entry, key)) return {
			entry,
			upstreamName: key.split("/")[0] ?? ""
		};
	}
	return null;
}
/**
* Record one `tools/call` outcome. Arguments and results are deliberately not
* recorded: they may carry secrets and the log is a health signal, not traffic.
* @param deps - handler dependencies.
* @param tool - client-visible tool name.
* @param upstream - upstream that served the call.
* @param ok - whether the call succeeded.
* @param latencyMs - call duration in milliseconds.
* @param error - failure message, truncated to 200 characters.
*/
function recordCall(deps, tool, upstream, ok, latencyMs, error) {
	const entry = {
		ts: nowSeconds(),
		tool,
		upstream,
		ok,
		latencyMs
	};
	deps.recordCall(error === void 0 ? entry : {
		...entry,
		error: error.slice(0, 200)
	});
}
/**
* Answer one `tools/call` request: resolve the tool, map the arguments, invoke
* the upstream, and turn every failure into a JSON-RPC error.
* @param deps - handler dependencies.
* @param config - live gateway configuration.
* @param clientId - naming mode the endpoint serves.
* @param toolset - resolved toolset the endpoint serves.
* @param params - the request's `params` object.
* @param id - JSON-RPC request id (echoed back).
* @returns status plus JSON-RPC body.
*/
async function handleToolCall(deps, config, clientId, toolset, params, id) {
	const rawName = params["name"];
	if (rawName === void 0 || rawName === null || rawName === "") return rpcError(id, -32602, "Missing required parameter: name");
	const toolName = typeof rawName === "string" ? rawName : String(rawName);
	const hit = findExposeEntry(config, toolName, clientId, toolset);
	if (hit === null) return rpcError(id, -32601, `Tool not found: ${toolName}`);
	const rawArguments = params["arguments"];
	const argumentsValue = isJsonObject$3(rawArguments) ? rawArguments : {};
	const transformStarted = performance.now();
	let upstreamArgs;
	try {
		upstreamArgs = paramTransformValue(argumentsValue, hit.entry);
	} catch (error) {
		if (!(error instanceof ParamError)) throw error;
		recordCall(deps, toolName, hit.upstreamName, false, Math.floor(performance.now() - transformStarted), messageOf$1(error));
		return rpcError(id, -32602, messageOf$1(error));
	}
	const transport = deps.transport(hit.upstreamName);
	if (transport === void 0) return rpcError(id, -32e3, `[gateway] upstream=${hit.upstreamName}: no transport`);
	const startedAt = performance.now();
	try {
		const result = await transport.callTool(hit.entry.tool, upstreamArgs);
		const latencyMs = Math.floor(performance.now() - startedAt);
		deps.logger.info(`tools/call ${toolName} -> upstream ${hit.upstreamName}/${hit.entry.tool}`);
		recordCall(deps, toolName, hit.upstreamName, true, latencyMs);
		return rpcResult(id, result);
	} catch (error) {
		const latencyMs = Math.floor(performance.now() - startedAt);
		if (error instanceof UpstreamHttpError) {
			if (error.status === 401 || error.status === 403 || error.status === 429) deps.onUpstreamStatus?.(hit.upstreamName, error.status);
			recordCall(deps, toolName, hit.upstreamName, false, latencyMs, `HTTP ${error.status}`);
			return rpcError(id, -32e3, `[gateway] upstream=${hit.upstreamName}: HTTP ${error.status}`);
		}
		const message = messageOf$1(error);
		deps.logger.error(`Upstream '${hit.upstreamName}' call_tool error: ${message}`);
		recordCall(deps, toolName, hit.upstreamName, false, latencyMs, message);
		return rpcError(id, -32e3, `[gateway] upstream=${hit.upstreamName}: ${message}`);
	}
}
/**
* Answer one MCP JSON-RPC request.
* @param deps - handler dependencies.
* @param ctx - routed request context.
* @returns status plus JSON-RPC response body, or the HTTP-layer 404 shapes for
* an unknown toolset / a disabled client naming mode.
*/
async function handleMcpRequest(deps, ctx) {
	const config = deps.config();
	if (config.clients?.[ctx.clientId] === false) return {
		status: 404,
		body: { error: `client '${ctx.clientId}' endpoint disabled` }
	};
	const rawToolset = ctx.rawToolset === "" ? config.serverName : ctx.rawToolset;
	const toolset = resolveToolset(config, rawToolset);
	if (toolset === null) return {
		status: 404,
		body: { error: `Unknown toolset: ${rawToolset}` }
	};
	const body = ctx.body;
	if (!isJsonObject$3(body)) return {
		status: 200,
		body: {
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32600,
				message: "Invalid Request: body must be a JSON object"
			}
		}
	};
	const id = body["id"] ?? null;
	const params = isJsonObject$3(body["params"]) ? body["params"] : {};
	const method = body["method"];
	if (method === "initialize") return rpcResult(id, {
		protocolVersion: PROTOCOL_VERSION,
		capabilities: { tools: {} },
		serverInfo: {
			name: `mcpp/${toolset}`,
			version: SERVER_VERSION
		}
	});
	if (method === "notifications/initialized") return {
		status: 202,
		body: {}
	};
	if (method === "tools/list") return rpcResult(id, { tools: await fetchAllTools(deps, config, ctx.clientId, toolset) });
	if (method === "tools/call") return handleToolCall(deps, config, ctx.clientId, toolset, params, id);
	if (method === "server/discover") return rpcResult(id, {
		protocolVersion: PROTOCOL_VERSION,
		serverInfo: {
			name: toolset,
			version: SERVER_VERSION
		},
		capabilities: { tools: {} }
	});
	return rpcError(id, -32601, `Unknown method: ${String(method)}`);
}
//#endregion
//#region src/admin.ts
/**
* Admin API layer: the `/api/*` management surface the ported admin page and
* the service owner use to inspect and edit the live configuration.
*
* Owner: gateway-admin. Contract: DESIGN.md § src/admin.ts and the retired
* service's `main.py:682-1223`.
*
* Every mutation is staged first: the candidate configuration is serialized and
* re-parsed (the same validation a restart performs) before it is handed to
* `persistConfig`. A rejected edit therefore never reaches the live object.
*
* @module
*/
/** Timeout marker for an admin-initiated `tools/list` probe. */
var ListTimeoutError = class extends Error {
	name = "ListTimeoutError";
};
/**
* Narrow an unknown JSON value to a plain object.
* @param value - candidate.
* @returns whether the value is a non-null, non-array object.
*/
function isJsonObject$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Render an unknown thrown value as a message.
* @param error - thrown value.
* @returns the message, or the stringified value.
*/
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Race a promise against a timeout.
* @param promise - the operation to cap.
* @param seconds - cap in seconds.
* @returns the operation's value.
* @throws ListTimeoutError when the cap expires first.
*/
function withTimeout(promise, seconds) {
	let timer;
	const timeout = new Promise((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new ListTimeoutError(`timed out after ${seconds}s`));
		}, seconds * 1e3);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer !== void 0) clearTimeout(timer);
	});
}
/** A 404 with the retired service's unknown-referent wording. */
function notFound(message = "Not Found") {
	return {
		status: 404,
		body: { error: message }
	};
}
/** A 400 with the retired service's `{error}` body. */
function badRequest(message) {
	return {
		status: 400,
		body: { error: message }
	};
}
/**
* Read a JSON object body, or undefined when it is not one.
* @param request - inbound request.
* @returns the parsed object, or undefined for null/array/scalar bodies.
*/
async function jsonObjectBody(request) {
	const body = await request.bodyJson();
	return isJsonObject$2(body) ? body : void 0;
}
/**
* Find one upstream by name.
* @param config - gateway configuration.
* @param name - upstream name.
* @returns the upstream, or undefined when absent.
*/
function findUpstream(config, name) {
	return config.upstreams.find((upstream) => upstream.name === name);
}
/**
* Copy a configuration with one upstream replaced.
* @param config - source configuration.
* @param index - index of the upstream to replace.
* @param upstream - replacement upstream.
* @returns a new configuration object.
*/
function withUpstream(config, index, upstream) {
	const upstreams = config.upstreams.map((existing, at) => at === index ? upstream : existing);
	return {
		...config,
		upstreams
	};
}
/**
* Copy a configuration with one expose entry written or deleted.
* @param config - source configuration.
* @param key - stable `upstream/tool` key.
* @param entry - replacement entry, or null to delete.
* @returns a new configuration object.
*/
function withExposeEntry(config, key, entry) {
	const expose = { ...config.expose };
	if (entry === null) delete expose[key];
	else expose[key] = entry;
	return {
		...config,
		expose
	};
}
/**
* Validate a candidate configuration the way a restart would.
* @param staged - candidate configuration.
* @returns the validation message, or undefined when valid.
*/
function validateStaged(staged) {
	try {
		parseConfig(dumpConfig(staged));
		return;
	} catch (error) {
		return messageOf(error);
	}
}
/**
* Validate a staged configuration and, when it passes, persist it.
* @param deps - admin dependencies.
* @param staged - candidate configuration.
* @param success - reply body on success.
* @returns the success reply, or a 400 carrying the validation message.
*/
async function persistStaged(deps, staged, success) {
	const invalid = validateStaged(staged);
	if (invalid !== void 0) return {
		status: 400,
		body: { error: invalid }
	};
	await deps.persistConfig(staged);
	return success;
}
/**
* Merge an expose entry's param transforms with the upstream tool's schema.
*
* Emits one row per upstream parameter (plus any transform whose upstream
* parameter disappeared, kept so edits are not lost). Each row carries the
* editable transform fields plus the read-only upstream context the admin page
* renders: `_upstream_name`, `_upstream_type`, `_upstream_description`, and
* `_required`.
* @param entry - expose entry.
* @param upstreamSchema - raw upstream `inputSchema`.
* @returns one row per parameter.
*/
function mergeParams(entry, upstreamSchema) {
	const schema = upstreamSchema ?? {};
	const properties = isJsonObject$2(schema["properties"]) ? schema["properties"] : {};
	const requiredRaw = schema["required"];
	const requiredNames = Array.isArray(requiredRaw) ? requiredRaw : [];
	const byUpstream = /* @__PURE__ */ new Map();
	for (const param of entry.params ?? []) byUpstream.set(param.mapFrom ?? param.name, param);
	const rows = [];
	const seen = /* @__PURE__ */ new Set();
	for (const [upstreamName, upstreamProperty] of Object.entries(properties)) {
		seen.add(upstreamName);
		const property = isJsonObject$2(upstreamProperty) ? upstreamProperty : {};
		const upstreamType = property["type"] ?? null;
		const upstreamDescription = "description" in property ? property["description"] ?? null : "";
		const param = byUpstream.get(upstreamName);
		if (param === void 0) {
			rows.push({
				name: upstreamName,
				map_from: upstreamName,
				hidden: false,
				default: null,
				type: null,
				mapping: null,
				preset: null,
				description: null,
				required: null,
				_upstream_name: upstreamName,
				_upstream_type: upstreamType,
				_upstream_description: upstreamDescription,
				_required: requiredNames.includes(upstreamName)
			});
			continue;
		}
		rows.push({
			name: param.name,
			map_from: param.mapFrom ?? null,
			hidden: param.hidden,
			default: param.default ?? null,
			type: param.type ?? null,
			mapping: param.mapping ?? null,
			preset: param.preset ?? null,
			description: param.description ?? null,
			required: param.required ?? null,
			_upstream_name: upstreamName,
			_upstream_type: upstreamType,
			_upstream_description: upstreamDescription,
			_required: requiredNames.includes(upstreamName)
		});
	}
	for (const [upstreamName, param] of byUpstream) {
		if (seen.has(upstreamName)) continue;
		rows.push({
			name: param.name,
			map_from: param.mapFrom ?? null,
			hidden: param.hidden,
			default: param.default ?? null,
			type: param.type ?? null,
			mapping: param.mapping ?? null,
			preset: param.preset ?? null,
			description: param.description ?? null,
			required: param.required ?? null,
			_upstream_name: upstreamName,
			_upstream_type: null,
			_upstream_description: "",
			_required: false
		});
	}
	return rows;
}
/**
* Fetch every upstream's raw (untransformed) tools for schema merging.
* Upstream failures are logged and skipped, matching the retired service.
* @param deps - admin dependencies.
* @param config - live gateway configuration.
* @returns upstream name -> tool name -> raw tool.
*/
async function fetchAllRawTools(deps, config) {
	const perUpstream = await Promise.all(config.upstreams.map(async (upstream) => {
		const byName = /* @__PURE__ */ new Map();
		const transport = deps.transport(upstream.name);
		if (transport === void 0) return [upstream.name, byName];
		try {
			const tools = await withTimeout(transport.listTools(), 30);
			for (const tool of tools) byName.set(tool.name, tool);
		} catch (error) {
			deps.logger.warn(`raw fetch upstream '${upstream.name}' failed: ${messageOf(error)}`);
		}
		return [upstream.name, byName];
	}));
	return new Map(perUpstream);
}
/**
* Read an optional string field.
* @param raw - JSON object.
* @param field - field name.
* @returns the string, or undefined for absent/null.
* @throws Error when the field is present with a non-string value.
*/
function optionalString(raw, field) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	return value;
}
/**
* Read an optional boolean field.
* @param raw - JSON object.
* @param field - field name.
* @returns the boolean, or undefined for absent/null.
* @throws Error when the field is present with a non-boolean value.
*/
function optionalBoolean(raw, field) {
	const value = raw[field];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
	return value;
}
/**
* Read a boolean field with a default.
* @param raw - JSON object.
* @param field - field name.
* @param fallback - value when the field is absent.
* @returns the boolean.
* @throws Error when the field is present with a non-boolean value.
*/
function booleanField(raw, field, fallback) {
	const value = optionalBoolean(raw, field);
	return value === void 0 ? fallback : value;
}
/**
* Build one validated param transform from a JSON object.
* @param raw - one `params[]` element.
* @param index - position in the list, for error messages.
* @returns the typed transform.
* @throws Error when a field has the wrong type.
*/
function buildParamTransform(raw, index) {
	const name = raw["name"];
	if (typeof name !== "string") throw new Error(`params[${index}].name is required and must be a string`);
	const param = {
		name,
		hidden: booleanField(raw, "hidden", false)
	};
	const mapFrom = optionalString(raw, "map_from");
	if (mapFrom !== void 0) param.mapFrom = mapFrom;
	const type = optionalString(raw, "type");
	if (type !== void 0) {
		if (type !== "enum" && type !== "preset") throw new Error(`params[${index}].type must be "enum" or "preset"`);
		param.type = type;
	}
	const mapping = raw["mapping"];
	if (mapping !== void 0 && mapping !== null) {
		if (!isJsonObject$2(mapping)) throw new Error(`params[${index}].mapping must be an object`);
		param.mapping = mapping;
	}
	const preset = raw["preset"];
	if (preset !== void 0 && preset !== null) {
		if (!isJsonObject$2(preset)) throw new Error(`params[${index}].preset must be an object`);
		const normalized = {};
		for (const [presetName, presetValue] of Object.entries(preset)) {
			if (!isJsonObject$2(presetValue)) throw new Error(`params[${index}].preset.${presetName} must be an object`);
			normalized[presetName] = presetValue;
		}
		param.preset = normalized;
	}
	const description = optionalString(raw, "description");
	if (description !== void 0) param.description = description;
	const required = optionalBoolean(raw, "required");
	if (required !== void 0) param.required = required;
	if ("default" in raw) param.default = raw["default"];
	return param;
}
/**
* Build one validated expose entry from a JSON body.
*
* `upstream`/`tool` are identity fields: they come from the existing entry, not
* from the body, so this endpoint can never repoint an entry at another tool.
* Read-only `_`-prefixed fields are dropped before this runs.
* @param raw - editable request body.
* @param identity - existing entry's upstream and tool.
* @returns the typed entry.
* @throws Error when a field has the wrong type.
*/
function buildExposeEntry(raw, identity) {
	const entry = {
		upstream: identity.upstream,
		tool: identity.tool,
		hide: booleanField(raw, "hide", false)
	};
	const as = optionalString(raw, "as");
	if (as !== void 0) entry.as = as;
	const toolset = optionalString(raw, "toolset");
	if (toolset !== void 0) entry.toolset = toolset;
	const description = optionalString(raw, "description");
	if (description !== void 0) entry.description = description;
	const params = raw["params"];
	if (params !== void 0 && params !== null) {
		if (!Array.isArray(params)) throw new Error("params must be a list");
		entry.params = params.map((item, index) => {
			if (!isJsonObject$2(item)) throw new Error(`params[${index}] must be an object`);
			return buildParamTransform(item, index);
		});
	}
	return entry;
}
/**
* Parse one Claude-Desktop-style server spec into an upstream definition.
*
* `command` selects stdio, `url` selects http. The first usable `headers` entry
* becomes the upstream's auth rotation pool: `Bearer <key>` is split into
* scheme + key; transport noise headers are ignored.
* @param name - server name from the input JSON.
* @param spec - one server spec object.
* @returns the upstream definition.
* @throws Error when the spec has neither `command` nor `url`, or a field has
* the wrong type.
*/
function parseClaudeDesktopEntry(name, spec) {
	const identity = {
		inheritEnv: ["PATH"],
		connectTimeout: 30,
		readTimeout: 120,
		listTimeout: 20
	};
	let upstream;
	if ("command" in spec) {
		const command = spec["command"];
		if (typeof command !== "string") throw new Error(`server '${name}': command must be a string`);
		upstream = {
			name,
			transport: "stdio",
			command,
			...identity
		};
		const args = spec["args"];
		if (args !== void 0 && args !== null) {
			if (!Array.isArray(args)) throw new Error(`server '${name}': args must be a list of strings`);
			const values = [];
			for (const value of args) {
				if (typeof value !== "string") throw new Error(`server '${name}': args must be a list of strings`);
				values.push(value);
			}
			upstream.args = values;
		}
		const env = spec["env"];
		if (env !== void 0 && env !== null) {
			if (!isJsonObject$2(env)) throw new Error(`server '${name}': env must be an object`);
			const values = {};
			for (const [key, value] of Object.entries(env)) {
				if (typeof value !== "string") throw new Error(`server '${name}': env values must be strings`);
				values[key] = value;
			}
			upstream.env = values;
		}
	} else if ("url" in spec) {
		const url = spec["url"];
		if (typeof url !== "string") throw new Error(`server '${name}': url must be a string`);
		upstream = {
			name,
			transport: "http",
			url,
			...identity
		};
	} else throw new Error(`server '${name}': spec must have 'command' or 'url'`);
	const headers = spec["headers"];
	if (headers !== void 0 && headers !== null) {
		if (!isJsonObject$2(headers)) throw new Error(`server '${name}': headers must be an object`);
		const noise = new Set([
			"content-type",
			"accept",
			"user-agent",
			"accept-encoding"
		]);
		for (const [headerName, headerValue] of Object.entries(headers)) {
			if (typeof headerValue !== "string") continue;
			if (noise.has(headerName.toLowerCase())) continue;
			const bearer = headerValue.startsWith("Bearer ");
			const token = (bearer ? headerValue.slice(7) : headerValue).trim();
			if (token === "") continue;
			upstream.auth = {
				keys: [token],
				header: headerName,
				scheme: bearer ? "Bearer " : ""
			};
			break;
		}
	}
	return upstream;
}
/**
* Probe an upstream's tool names with a throwaway transport.
* @param deps - admin dependencies.
* @param upstream - upstream to probe.
* @returns raw tool names.
* @throws when the probe fails.
*/
async function probeTools(deps, upstream) {
	const transport = deps.createProbeTransport(upstream);
	try {
		return (await withTimeout(transport.listTools(), 30)).map((tool) => tool.name);
	} finally {
		await transport.close();
	}
}
/** Read the `key_index` body field of the resume route. */
function readKeyIndex(body, fallback) {
	if (!isJsonObject$2(body)) return fallback;
	const value = body["key_index"] ?? fallback;
	if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("key_index must be an integer");
	return value;
}
/** Parse a `key_index` path segment. */
function parseKeyIndex(raw) {
	if (!/^-?\d+$/.test(raw)) throw new Error(`key_index must be an integer, got '${raw}'`);
	return Number.parseInt(raw, 10);
}
/** `GET /api/config` — current configuration as YAML text. */
async function getConfigYaml(deps) {
	return {
		status: 200,
		body: { yaml: dumpConfig(deps.config()) }
	};
}
/** `POST /api/config` — replace the whole configuration from YAML text. */
async function replaceConfig(deps, request) {
	const text = await request.bodyText();
	let next;
	try {
		next = parseConfig(text);
	} catch (error) {
		return badRequest(messageOf(error));
	}
	await deps.persistConfig(next);
	return {
		status: 200,
		body: { status: "reloaded" }
	};
}
/** `GET /api/tools` — preview the downstream tool surface. */
async function listToolsPreview(deps, request) {
	const config = deps.config();
	let toolset = request.query.get("toolset") ?? void 0;
	if (toolset === "mcpp") toolset = config.serverName;
	return {
		status: 200,
		body: await fetchAllTools(deps, config, request.query.get("client") ?? "default", toolset)
	};
}
/** `GET /api/upstreams` — configured upstream names. */
async function listUpstreamNames(deps) {
	return {
		status: 200,
		body: deps.config().upstreams.map((upstream) => upstream.name)
	};
}
/** `GET /api/upstreams/{name}` — identity plus editable env fields. */
async function getUpstream(deps, name) {
	const upstream = findUpstream(deps.config(), name);
	if (upstream === void 0) return notFound(`Unknown upstream: ${name}`);
	return {
		status: 200,
		body: {
			name: upstream.name,
			transport: upstream.transport,
			env: upstream.env ?? null,
			inherit_env: upstream.transport === "stdio" ? upstream.inheritEnv : null
		}
	};
}
/** `PUT /api/upstreams/{name}` — edit only env and inherit_env. */
async function putUpstream(deps, request, name) {
	const config = deps.config();
	const index = config.upstreams.findIndex((upstream) => upstream.name === name);
	if (index === -1) return notFound(`Unknown upstream: ${name}`);
	const body = await jsonObjectBody(request);
	if (body === void 0) return badRequest("body must be a JSON object");
	const next = { ...config.upstreams[index] };
	if ("env" in body) {
		const envValue = body["env"];
		if (envValue !== void 0 && envValue !== null && !isJsonObject$2(envValue)) return badRequest("env must be an object or null");
		if (isJsonObject$2(envValue)) {
			const env = {};
			for (const [key, value] of Object.entries(envValue)) {
				if (typeof value !== "string") return badRequest("env keys and values must be strings");
				env[key] = value;
			}
			next.env = env;
		} else delete next.env;
	}
	if ("inherit_env" in body) {
		const inheritValue = body["inherit_env"];
		const list = inheritValue === void 0 || inheritValue === null ? [] : inheritValue;
		if (!Array.isArray(list)) return badRequest("inherit_env must be a list of strings");
		const values = [];
		for (const value of list) {
			if (typeof value !== "string") return badRequest("inherit_env must be a list of strings");
			values.push(value);
		}
		next.inheritEnv = values;
	}
	return persistStaged(deps, withUpstream(config, index, next), {
		status: 200,
		body: {
			status: "saved",
			name
		}
	});
}
/** `GET /api/upstreams/{name}/tools` — raw upstream tools, untransformed. */
async function rawUpstreamTools(deps, name) {
	const transport = deps.transport(name);
	if (transport === void 0) return notFound(`Unknown upstream: ${name}`);
	try {
		return {
			status: 200,
			body: {
				upstream: name,
				tools: (await withTimeout(transport.listTools(), 30)).map((tool) => ({
					name: tool.name,
					description: tool.description ?? null,
					inputSchema: tool.inputSchema ?? null
				}))
			}
		};
	} catch (error) {
		return {
			status: 502,
			body: { error: messageOf(error) }
		};
	}
}
/** `POST /api/upstreams/{name}/test` — connectivity probe with raw tool names. */
async function testUpstream(deps, name) {
	const transport = deps.transport(name);
	if (transport === void 0) return notFound(`Unknown upstream: ${name}`);
	const startedAt = performance.now();
	try {
		const tools = await withTimeout(transport.listTools(), 30);
		return {
			status: 200,
			body: {
				ok: true,
				latency_ms: Math.floor(performance.now() - startedAt),
				tool_count: tools.length,
				tools: tools.map((tool) => ({
					name: tool.name,
					description: tool.description ?? null
				})),
				error: null
			}
		};
	} catch (error) {
		const message = messageOf(error);
		deps.logger.warn(`Test upstream '${name}' failed: ${message}`);
		return {
			status: 200,
			body: {
				ok: false,
				latency_ms: Math.floor(performance.now() - startedAt),
				tool_count: 0,
				tools: [],
				error: message
			}
		};
	}
}
/** `GET /api/toolsets` — aggregated servers and their member tool keys. */
async function listToolsets(deps) {
	const config = deps.config();
	const groups = new Map([[config.serverName, []]]);
	for (const [key, entry] of Object.entries(config.expose)) {
		if (entry.hide) continue;
		const name = entry.toolset ?? config.serverName;
		const members = groups.get(name);
		if (members === void 0) groups.set(name, [key]);
		else members.push(key);
	}
	return {
		status: 200,
		body: [...groups].map(([toolset, tools]) => ({
			toolset,
			tools,
			default: toolset === config.serverName
		}))
	};
}
/** `GET /api/expose` — expose entries with the upstream schema merged in. */
async function listExpose(deps) {
	const config = deps.config();
	const raw = await fetchAllRawTools(deps, config);
	const out = [];
	for (const [key, entry] of Object.entries(config.expose)) {
		const upstreamTool = raw.get(entry.upstream)?.get(entry.tool);
		out.push({
			key,
			upstream: entry.upstream,
			tool: entry.tool,
			as: entry.as ?? null,
			toolset: entry.toolset ?? config.serverName,
			hide: entry.hide,
			description: entry.description ?? null,
			raw_description: upstreamTool?.description ?? null,
			params: mergeParams(entry, upstreamTool?.inputSchema)
		});
	}
	return {
		status: 200,
		body: out
	};
}
/** `PUT /api/expose/{key}` — replace one expose entry's editable fields. */
async function putExpose(deps, request, key) {
	const config = deps.config();
	const existing = config.expose[key];
	if (existing === void 0) return notFound(`Unknown expose key: ${key}`);
	const body = await jsonObjectBody(request);
	if (body === void 0) return badRequest("body must be a JSON object");
	const editable = {};
	for (const [field, value] of Object.entries(body)) {
		if (field.startsWith("_")) continue;
		editable[field] = value;
	}
	let entry;
	try {
		entry = buildExposeEntry(editable, {
			upstream: existing.upstream,
			tool: existing.tool
		});
	} catch (error) {
		return badRequest(messageOf(error));
	}
	return persistStaged(deps, withExposeEntry(config, key, entry), {
		status: 200,
		body: {
			status: "saved",
			key
		}
	});
}
/** `DELETE /api/expose/{key}` — delete one entry unless something references it. */
async function deleteExpose(deps, key) {
	const config = deps.config();
	if (config.expose[key] === void 0) return notFound(`Unknown expose key: ${key}`);
	const referrers = Object.entries(config.expose).filter(([other, entry]) => other !== key && entry.description !== void 0 && entry.description !== "" && entry.description.includes(`\`${key}\``)).map(([other]) => other);
	if (referrers.length > 0) return {
		status: 409,
		body: { error: `Cannot delete '${key}': referenced by [${referrers.map((referrer) => `'${referrer}'`).join(", ")}]. Remove those backtick refs first.` }
	};
	return persistStaged(deps, withExposeEntry(config, key, null), {
		status: 200,
		body: {
			status: "deleted",
			key
		}
	});
}
/** `POST /api/add-server` — add servers from Claude-Desktop-style JSON. */
async function addServer(deps, request) {
	const body = await jsonObjectBody(request);
	if (body === void 0) return badRequest("body must be a JSON object");
	const rawText = body["json_text"] ?? "";
	if (typeof rawText !== "string") return badRequest("json_text must be a string");
	const toolsetValue = body["toolset"];
	let toolset;
	if (toolsetValue !== void 0 && toolsetValue !== null && toolsetValue !== "") {
		if (typeof toolsetValue !== "string") return badRequest("toolset must be a string");
		toolset = toolsetValue;
	}
	let parsed;
	try {
		parsed = JSON.parse(rawText);
	} catch (error) {
		return badRequest(`Invalid JSON: ${messageOf(error)}`);
	}
	if (!isJsonObject$2(parsed)) return badRequest("Top-level JSON must be an object");
	const wrapped = parsed["mcpServers"];
	const servers = isJsonObject$2(wrapped) ? wrapped : parsed;
	const config = deps.config();
	let upstreams = [...config.upstreams];
	let expose = { ...config.expose };
	let existingNames = new Set(upstreams.map((upstream) => upstream.name));
	const added = [];
	const errors = [];
	for (const [serverName, spec] of Object.entries(servers)) try {
		if (!isJsonObject$2(spec)) throw new Error("server spec must be an object");
		const upstream = parseClaudeDesktopEntry(serverName, spec);
		let rawTools;
		try {
			rawTools = await probeTools(deps, upstream);
		} catch (error) {
			throw new Error(`failed to fetch tools: ${messageOf(error)}`);
		}
		const candidateUpstreams = [...upstreams];
		const candidateExpose = { ...expose };
		const candidateNames = new Set(existingNames);
		if (!candidateNames.has(serverName)) {
			candidateUpstreams.push(upstream);
			candidateNames.add(serverName);
		}
		const newTools = [];
		for (const toolName of rawTools) {
			const key = `${serverName}/${toolName}`;
			if (key in candidateExpose) continue;
			const entry = {
				upstream: serverName,
				tool: toolName,
				hide: false
			};
			if (toolset !== void 0) entry.toolset = toolset;
			candidateExpose[key] = entry;
			newTools.push(toolName);
		}
		const invalid = validateStaged({
			...config,
			upstreams: candidateUpstreams,
			expose: candidateExpose
		});
		if (invalid !== void 0) throw new ConfigError(invalid);
		upstreams = candidateUpstreams;
		expose = candidateExpose;
		existingNames = candidateNames;
		added.push({
			server: serverName,
			toolset: toolset ?? null,
			tools: newTools
		});
		deps.logger.info(`Added server '${serverName}' via JSON (${newTools.length} tools, toolset=${toolset ?? "None"})`);
	} catch (error) {
		errors.push({
			server: serverName,
			error: messageOf(error)
		});
	}
	if (added.length === 0) return {
		status: 400,
		body: {
			added: [],
			errors: errors.length > 0 ? errors : [{
				server: "*",
				error: "no servers added"
			}]
		}
	};
	await deps.persistConfig({
		...config,
		upstreams,
		expose
	});
	return {
		status: 200,
		body: {
			added,
			errors
		}
	};
}
/** `GET /api/keys` — key-pool status for every upstream that has one. */
async function listKeys(deps) {
	const body = {};
	for (const [name, pool] of deps.keypools()) body[name] = {
		healthy_count: pool.healthyCount,
		keys: pool.statuses()
	};
	return {
		status: 200,
		body
	};
}
/** `GET /api/calls` — recorded tool calls, newest first. */
async function listCalls(deps) {
	return {
		status: 200,
		body: [...deps.callLogSnapshot()].reverse()
	};
}
/** `POST /api/keys/{upstream}/resume` — resume one paused key. */
async function resumeKey(deps, request, upstreamName) {
	const pool = deps.keypool(upstreamName);
	if (pool === void 0) return notFound("No keypool for this upstream");
	const keyIndex = readKeyIndex(await request.bodyJson(), 0);
	const key = pool.keyAt(keyIndex);
	pool.resume(key);
	deps.logger.info(`Upstream '${upstreamName}': key ${keyIndex} resumed manually`);
	return {
		status: 200,
		body: {
			status: "resumed",
			key: `${key.slice(0, 4)}...`
		}
	};
}
/** `POST /api/keys/{upstream}` — append one key to an upstream's pool. */
async function addKey(deps, request, upstreamName) {
	const config = deps.config();
	const index = config.upstreams.findIndex((upstream) => upstream.name === upstreamName);
	if (index === -1) return notFound(`Unknown upstream: ${upstreamName}`);
	const upstream = config.upstreams[index];
	if (upstream.auth === void 0) return badRequest(`Upstream '${upstreamName}' has no auth block. Add one (with header+scheme) in the YAML first.`);
	const body = await jsonObjectBody(request);
	if (body === void 0) return badRequest("body must be {\"key\": \"...\"}");
	const keyValue = body["key"];
	if (typeof keyValue !== "string" || keyValue.trim() === "") return badRequest("body must be {\"key\": \"...\"}");
	const keys = [...upstream.auth.keys, keyValue.trim()];
	const reply = await persistStaged(deps, withUpstream(config, index, {
		...upstream,
		auth: {
			...upstream.auth,
			keys
		}
	}), {
		status: 200,
		body: {
			status: "added",
			count: keys.length
		}
	});
	if (reply.status === 200) deps.logger.info(`Upstream '${upstreamName}': key added (${keys.length} total)`);
	return reply;
}
/** `DELETE /api/keys/{upstream}/{key_index}` — remove one key by index. */
async function deleteKey(deps, upstreamName, rawIndex) {
	const config = deps.config();
	const index = config.upstreams.findIndex((upstream) => upstream.name === upstreamName);
	if (index === -1) return notFound(`Unknown upstream: ${upstreamName}`);
	const upstream = config.upstreams[index];
	if (upstream.auth === void 0 || upstream.auth.keys.length === 0) return notFound("No keys to delete");
	let keyIndex;
	try {
		keyIndex = parseKeyIndex(rawIndex);
	} catch (error) {
		return badRequest(messageOf(error));
	}
	if (keyIndex < 0 || keyIndex >= upstream.auth.keys.length) return badRequest(`key_index ${keyIndex} out of range`);
	const keys = upstream.auth.keys.filter((_key, at) => at !== keyIndex);
	const reply = await persistStaged(deps, withUpstream(config, index, {
		...upstream,
		auth: {
			...upstream.auth,
			keys
		}
	}), {
		status: 200,
		body: {
			status: "deleted",
			count: keys.length
		}
	});
	if (reply.status === 200) deps.logger.info(`Upstream '${upstreamName}': key ${keyIndex} deleted (${keys.length} remain)`);
	return reply;
}
/**
* Route one `/api/upstreams/...` request.
* @param deps - admin dependencies.
* @param request - inbound request.
* @param segments - path segments after `upstreams`.
* @returns the reply.
*/
async function handleUpstreamRoute(deps, request, segments) {
	if (segments.length === 0) return request.method === "GET" ? listUpstreamNames(deps) : notFound();
	const name = segments[0];
	const tail = segments.slice(1);
	if (tail.length === 0) {
		if (request.method === "GET") return getUpstream(deps, name);
		if (request.method === "PUT") return putUpstream(deps, request, name);
		return notFound();
	}
	if (tail.length === 1 && tail[0] === "tools" && request.method === "GET") return rawUpstreamTools(deps, name);
	if (tail.length === 1 && tail[0] === "test" && request.method === "POST") return testUpstream(deps, name);
	return notFound();
}
/**
* Route one `/api/expose/...` request.
* @param deps - admin dependencies.
* @param request - inbound request.
* @param segments - path segments after `expose`; a key may contain `/`.
* @returns the reply.
*/
async function handleExposeRoute(deps, request, segments) {
	if (segments.length === 0) return request.method === "GET" ? listExpose(deps) : notFound();
	const key = segments.join("/");
	if (request.method === "PUT") return putExpose(deps, request, key);
	if (request.method === "DELETE") return deleteExpose(deps, key);
	return notFound();
}
/**
* Route one `/api/keys/...` request.
* @param deps - admin dependencies.
* @param request - inbound request.
* @param segments - path segments after `keys`.
* @returns the reply.
*/
async function handleKeysRoute(deps, request, segments) {
	if (segments.length === 0) return request.method === "GET" ? listKeys(deps) : notFound();
	const upstreamName = segments[0];
	const tail = segments.slice(1);
	if (tail.length === 0) return request.method === "POST" ? addKey(deps, request, upstreamName) : notFound();
	if (tail.length === 1 && tail[0] === "resume" && request.method === "POST") return resumeKey(deps, request, upstreamName);
	if (tail.length === 1 && request.method === "DELETE") return deleteKey(deps, upstreamName, tail[0]);
	return notFound();
}
/**
* Answer one admin API request.
* @param deps - admin dependencies (config, key pools, reload, probe factory).
* @param request - routed request.
* @returns status plus JSON body in the retired service's shape.
*/
async function handleAdminRequest(deps, request) {
	const head = request.segments[0];
	const rest = request.segments.slice(1);
	switch (head) {
		case "config":
			if (rest.length > 0) return notFound();
			if (request.method === "GET") return getConfigYaml(deps);
			if (request.method === "POST") return replaceConfig(deps, request);
			return notFound();
		case "tools":
			if (rest.length > 0) return notFound();
			return request.method === "GET" ? listToolsPreview(deps, request) : notFound();
		case "toolsets":
			if (rest.length > 0) return notFound();
			return request.method === "GET" ? listToolsets(deps) : notFound();
		case "client-presets":
			if (rest.length > 0) return notFound();
			return request.method === "GET" ? {
				status: 200,
				body: presets()
			} : notFound();
		case "upstreams": return handleUpstreamRoute(deps, request, rest);
		case "expose": return handleExposeRoute(deps, request, rest);
		case "keys": return handleKeysRoute(deps, request, rest);
		case "add-server":
			if (rest.length > 0) return notFound();
			return request.method === "POST" ? addServer(deps, request) : notFound();
		case "calls":
			if (rest.length > 0) return notFound();
			return request.method === "GET" ? listCalls(deps) : notFound();
		default: return notFound();
	}
}
//#endregion
//#region src/server.ts
/**
* HTTP carrier for the gateway: one `node:http` listener that routes the
* retired service's URL space onto the MCP protocol layer and the admin API.
*
* The route table, status codes, and body shapes mirror the FastAPI app being
* replaced: same paths, same `{"detail": ...}` bodies for framework-level
* failures (404/405), same `{"error": ...}` bodies for handler failures.
*
* @module
*/
/** JSON body helper: one `application/json` response. */
function jsonReply(status, body, headers) {
	return {
		status,
		body,
		headers
	};
}
/** Framework-level not-found body, matching FastAPI. */
function detail(status, message) {
	return jsonReply(status, { detail: message });
}
/**
* Constant-time string equality over SHA-256 digests (length-independent).
* @param provided - caller-supplied token.
* @param expected - configured token.
* @returns whether they are equal.
*/
function tokenEquals(provided, expected) {
	return timingSafeEqual(createHash("sha256").update(provided, "utf8").digest(), createHash("sha256").update(expected, "utf8").digest());
}
/** Read a request body to a UTF-8 string. */
async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	return Buffer.concat(chunks).toString("utf8");
}
/** Methods the admin API answers; anything else is a 405 at the framework layer. */
const ADMIN_METHODS = new Set([
	"GET",
	"POST",
	"PUT",
	"DELETE"
]);
/**
* Resolve one request path onto the route table.
* @param segments - percent-decoded path segments.
* @param method - HTTP method.
* @returns the route the request maps to.
*/
function routeFor(segments, method) {
	if (segments.length === 1 && segments[0] === "mcp") return method === "POST" ? { kind: "legacy-mcp" } : { kind: "method-not-allowed" };
	const naming = segments[1];
	if (segments.length === 3 && segments[2] === "mcp" && naming !== void 0 && NAMING_IDS.includes(naming)) return method === "POST" ? {
		kind: "mcp",
		clientId: naming,
		rawToolset: segments[0]
	} : { kind: "method-not-allowed" };
	if (segments.length === 1 && segments[0] === "admin") return method === "GET" || method === "HEAD" ? { kind: "admin-ui" } : { kind: "method-not-allowed" };
	if (segments[0] === "api") return ADMIN_METHODS.has(method) ? {
		kind: "admin",
		segments: segments.slice(1)
	} : { kind: "method-not-allowed" };
	if (segments[0] === "mcp") return { kind: "not-found" };
	return { kind: "not-found" };
}
/**
* Extract a token from the `Authorization: Bearer` header, `?token=`, or the
* session cookie, in that order.
* @param req - inbound request.
* @param url - parsed request URL.
* @returns the presented token and its source.
*/
function presentedToken(req, url) {
	const header = req.headers.authorization ?? "";
	if (header.toLowerCase().startsWith("bearer ")) return {
		token: header.slice(7).trim(),
		source: "header"
	};
	const query = url.searchParams.get("token");
	if (query !== null) return {
		token: query,
		source: "query"
	};
	const cookie = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
	if (cookie !== void 0) return {
		token: cookie,
		source: "cookie"
	};
	return {
		token: void 0,
		source: ""
	};
}
/**
* Read one cookie value out of a `Cookie` header.
* @param header - raw `Cookie` header.
* @param name - cookie name.
* @returns the value, or undefined when absent.
*/
function readCookie(header, name) {
	if (header === void 0) return void 0;
	for (const part of header.split(";")) {
		const at = part.indexOf("=");
		if (at === -1) continue;
		if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
	}
}
/**
* Build the HTTP server for the gateway. Nothing binds until {@link HttpServerHandle.start}.
* @param options - route dependencies, bind address, and the admin page path.
* @returns the server handle.
*/
function createHttpServer(options) {
	const { runtime, mcp, admin, logger } = options;
	const env = options.env ?? process.env;
	let server;
	let adminHtml;
	let bound;
	/** The live gateway token, resolved through `${VAR}` on every request. */
	const expectedToken = () => {
		const configured = runtime.config.auth?.token;
		if (configured === void 0 || configured === "") return "";
		return resolveEnvValue(configured, env);
	};
	/** Write one reply, applying the `?token=` -> cookie session upgrade. */
	const send = (res, reply, setCookie) => {
		const headers = { ...reply.headers };
		headers["content-type"] = headers["content-type"] ?? "application/json";
		if (setCookie !== void 0) headers["set-cookie"] = `${AUTH_COOKIE_NAME}=${setCookie}; Max-Age=${AUTH_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`;
		const payload = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
		res.writeHead(reply.status, headers);
		res.end(payload);
	};
	/** Full request lifecycle: route, authenticate, dispatch, respond. */
	const handle = async (req, res) => {
		const method = req.method ?? "GET";
		const url = new URL(req.url ?? "/", "http://placeholder");
		let segments;
		try {
			segments = url.pathname.split("/").filter((segment) => segment !== "").map(decodeURIComponent);
		} catch {
			send(res, detail(400, "Invalid path encoding"), void 0);
			return;
		}
		const route = routeFor(segments, method);
		if (route.kind === "not-found") {
			send(res, detail(404, "Not Found"), void 0);
			return;
		}
		if (route.kind === "method-not-allowed") {
			send(res, detail(405, "Method Not Allowed"), void 0);
			return;
		}
		const presented = presentedToken(req, url);
		const expected = expectedToken();
		if (expected !== "" && (presented.token === void 0 || !tokenEquals(presented.token, expected))) {
			send(res, detail(401, "Invalid or missing token"), void 0);
			return;
		}
		const cookieUpgrade = expected !== "" && presented.source === "query" && readCookie(req.headers.cookie, "mcpp_token") === void 0 ? presented.token : void 0;
		try {
			if (route.kind === "admin-ui") {
				if (adminHtml === void 0) throw new Error("admin page was not loaded");
				send(res, jsonReply(200, adminHtml, { "content-type": "text/html; charset=utf-8" }), cookieUpgrade);
				return;
			}
			if (route.kind === "admin") {
				const bodyText = () => readBody(req);
				const reply = await handleAdminRequest(admin, {
					method,
					segments: route.segments,
					query: url.searchParams,
					bodyText,
					bodyJson: async () => JSON.parse(await bodyText())
				});
				send(res, reply, reply.status === 200 ? cookieUpgrade : void 0);
				return;
			}
			const bodyText = await readBody(req);
			let body;
			try {
				body = JSON.parse(bodyText);
			} catch {
				send(res, {
					status: 400,
					body: {
						jsonrpc: "2.0",
						id: null,
						error: {
							code: -32700,
							message: "Parse error"
						}
					}
				}, void 0);
				return;
			}
			const reply = await handleMcpRequest(mcp, {
				clientId: route.kind === "legacy-mcp" ? "default" : route.clientId,
				rawToolset: route.kind === "legacy-mcp" ? "" : route.rawToolset,
				body
			});
			send(res, reply, reply.status === 200 ? cookieUpgrade : void 0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`request ${method} ${url.pathname} failed: ${message}`);
			if (!res.headersSent) send(res, detail(500, "Internal Server Error"), void 0);
			else res.destroy();
		}
	};
	return {
		get address() {
			return bound;
		},
		async start() {
			adminHtml = await readFile(options.adminHtmlPath, "utf8");
			const httpServer = createServer((req, res) => {
				handle(req, res).catch((error) => {
					logger.error(`unhandled request failure: ${error instanceof Error ? error.message : String(error)}`);
					if (!res.headersSent) {
						res.writeHead(500);
						res.end();
					} else res.destroy();
				});
			});
			server = httpServer;
			await new Promise((resolve, reject) => {
				const onError = (error) => {
					httpServer.off("listening", onListening);
					reject(error);
				};
				const onListening = () => {
					httpServer.off("error", onError);
					resolve();
				};
				httpServer.once("error", onError);
				httpServer.once("listening", onListening);
				httpServer.listen(options.port, options.host);
			});
			const address = httpServer.address();
			bound = {
				host: options.host,
				port: address.port
			};
			return bound;
		},
		async close() {
			const httpServer = server;
			server = void 0;
			bound = void 0;
			if (httpServer === void 0) return;
			await new Promise((resolve) => {
				httpServer.close(() => {
					resolve();
				});
				httpServer.closeAllConnections();
			});
		}
	};
}
//#endregion
//#region src/upstream-stdio.ts
/**
* stdio upstream transport: one spawned child process speaking JSON-RPC on
* stdin/stdout, with both supported framings (newline-delimited JSON and
* `Content-Length` blocks), per-call timeout isolation, respawn after EOF, and
* best-effort child cleanup.
*
* Concurrency model: a single reader loop drains stdout and dispatches each
* frame to the caller waiting on its request id; stdin writes are serialized
* through a promise chain so two frames can never interleave bytes, while
* requests themselves stay in flight concurrently so a server that handles
* requests in-process is not serialized by this client.
*
* Owner: upstream. Contract: DESIGN.md § src/upstream-stdio.ts and
* the retired service's `upstream.py:274-612`.
*
* @module
*/
/** Seconds a single request may wait for its response. */
const DEFAULT_READ_TIMEOUT$1 = 120;
/** Host env vars a child keeps when the config omits `inherit_env`. */
const DEFAULT_INHERIT_ENV = ["PATH"];
/** Graceful wait for the child to exit before escalating to a kill (ms). */
const TERMINATE_GRACE_MS = 5e3;
/** How long the reader waits for the child to exit before reporting EOF (ms). */
const EXIT_REPORT_WAIT_MS = 1e3;
/** Upper bound on stderr kept for the exit message; only 500 chars are reported. */
const STDERR_CAPTURE_LIMIT = 8 * 1024;
/**
* Report whether an untrusted JSON value is a JSON object (not null, not an array).
* @param value - value to inspect.
* @returns true when `value` is a non-null, non-array object.
*/
function isJsonObject$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Render the `message` of a JSON-RPC `error` member.
* @param value - the untrusted `error` member.
* @returns its message, or `'unknown'` when there is none.
*/
function rpcErrorMessage$1(value) {
	if (isJsonObject$1(value)) {
		const message = value["message"];
		if (typeof message === "string") return message;
	}
	return "unknown";
}
/**
* Project one untrusted wire tool into the gateway's `Tool` type; unknown
* members are dropped, mirroring the retired service's pydantic model.
* @param value - one entry of a `tools/list` result.
* @returns the tool, or null when the entry is not an object with a string name.
*/
function toTool$1(value) {
	if (!isJsonObject$1(value)) return null;
	const name = value["name"];
	if (typeof name !== "string") return null;
	const tool = { name };
	const description = value["description"];
	if (typeof description === "string") tool.description = description;
	const inputSchema = value["inputSchema"];
	if (isJsonObject$1(inputSchema)) tool.inputSchema = inputSchema;
	const annotations = value["annotations"];
	if (isJsonObject$1(annotations)) tool.annotations = annotations;
	const title = value["title"];
	if (typeof title === "string") tool.title = title;
	return tool;
}
/**
* Buffered stdout reader for framing work. Bytes accumulate until a frame
* reader consumes them; EOF surfaces as a null line (or a short-body error for
* a `Content-Length` block).
*/
var StdoutReader = class {
	buffer = Buffer.alloc(0);
	eof = false;
	failure = null;
	waiters = [];
	/** @param stream - the child's stdout. */
	constructor(stream) {
		stream.on("data", (chunk) => {
			this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
			this.wake();
		});
		stream.on("end", () => {
			this.eof = true;
			this.wake();
		});
		stream.on("close", () => {
			this.eof = true;
			this.wake();
		});
		stream.on("error", (error) => {
			this.failure = error;
			this.eof = true;
			this.wake();
		});
	}
	/**
	* Read one newline-terminated line. A partial line at EOF is returned; a
	* clean EOF returns null.
	* @returns the line without its trailing newline, or null at EOF.
	*/
	async readLine() {
		for (;;) {
			const index = this.buffer.indexOf(10);
			if (index !== -1) {
				const line = this.buffer.subarray(0, index).toString("utf8");
				this.consume(index + 1);
				return line;
			}
			if (this.failure !== null) throw this.failure;
			if (this.eof) {
				if (this.buffer.length === 0) return null;
				const line = this.buffer.toString("utf8");
				this.consume(this.buffer.length);
				return line;
			}
			await this.waitForData();
		}
	}
	/**
	* Read exactly `length` bytes of a body.
	* @param length - byte count from the frame's `Content-Length` header.
	* @returns the body.
	*/
	async readExactly(length) {
		for (;;) {
			if (this.buffer.length >= length) {
				const body = this.buffer.subarray(0, length);
				this.consume(length);
				return Buffer.from(body);
			}
			if (this.failure !== null) throw this.failure;
			if (this.eof) throw new Error("stdio stream ended inside a Content-Length body");
			await this.waitForData();
		}
	}
	/** Drop the first `length` buffered bytes. */
	consume(length) {
		this.buffer = this.buffer.subarray(length);
	}
	/** Wait for more buffered bytes or EOF. */
	async waitForData() {
		await new Promise((resolve) => {
			this.waiters.push(resolve);
		});
	}
	/** Wake every reader waiting on more data. */
	wake() {
		const waiters = this.waiters;
		this.waiters = [];
		for (const waiter of waiters) waiter();
	}
};
/** One spawned MCP server connection. */
var StdioTransport = class {
	name;
	command;
	args;
	extraEnv;
	inheritEnv;
	readTimeout;
	child = null;
	requestId = 0;
	/** Set when the child is up and the handshake finished; cleared on reader EOF. */
	ready = false;
	/** The in-flight spawn + handshake, shared by concurrent first callers. */
	initializing = null;
	pending = /* @__PURE__ */ new Map();
	/** Serializes stdin writes so frames never interleave. */
	writeQueue = Promise.resolve();
	/** Completion of the current reader loop, awaited by {@link close}. */
	readerDone = null;
	/** @param options - command, environment, and timeout. */
	constructor(options) {
		this.name = options.name;
		this.command = options.command;
		this.args = options.args ?? [];
		this.extraEnv = options.env ?? {};
		this.inheritEnv = options.inheritEnv ?? DEFAULT_INHERIT_ENV;
		this.readTimeout = options.readTimeout ?? DEFAULT_READ_TIMEOUT$1;
	}
	/**
	* Spawn the child and complete the MCP handshake when the transport is not
	* ready yet. Concurrent callers share one spawn.
	* @returns resolves once the handshake completed and requests may be sent.
	*/
	ensureProcess() {
		if (this.ready) return Promise.resolve();
		const inflight = this.initializing;
		if (inflight !== null) return inflight;
		const started = this.startProcess();
		this.initializing = started;
		const clear = () => {
			if (this.initializing === started) this.initializing = null;
		};
		started.then(clear, clear);
		return started;
	}
	/** Tear down a child left behind by a handshake that never finished. */
	async closeIfUnready() {
		if (!this.ready) await this.close();
	}
	/** Synchronous last-resort kill for teardown paths with no live event loop. */
	killNowait() {
		const child = this.child;
		if (child === null) return;
		this.signalChild(child, true);
	}
	/** Fetch the upstream tool list (raw). */
	async listTools() {
		const result = (await this.rpc("tools/list", {}))["result"];
		if (!isJsonObject$1(result)) return [];
		const tools = result["tools"];
		if (!Array.isArray(tools)) return [];
		const projected = [];
		for (const entry of tools) {
			const tool = toTool$1(entry);
			if (tool !== null) projected.push(tool);
		}
		return projected;
	}
	/** Invoke one upstream tool and return its JSON-RPC `result`. */
	async callTool(name, args) {
		const result = (await this.rpc("tools/call", {
			name,
			arguments: args
		}))["result"];
		return isJsonObject$1(result) ? result : {};
	}
	/** Terminate the child and fail every caller still waiting on it. */
	async close() {
		const child = this.child;
		if (child !== null) {
			this.signalChild(child, false);
			if (!await this.waitForExit(child, TERMINATE_GRACE_MS)) {
				this.signalChild(child, true);
				await this.waitForExit(child, TERMINATE_GRACE_MS);
			}
		}
		await this.awaitReader();
		if (this.child === child) this.child = null;
		this.failPending(`Stdio upstream '${this.name}': closed`);
		this.ready = false;
	}
	/**
	* Spawn a child, start its reader loop, and run the handshake.
	* @returns resolves once the transport is ready for requests.
	*/
	async startProcess() {
		await this.reapLingeringChild();
		this.failPending(`Stdio upstream '${this.name}': transport respawned`);
		this.requestId = 0;
		let child;
		try {
			child = spawn(this.command, this.args, {
				env: this.mergedEnv(),
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				],
				windowsHide: true
			});
		} catch (error) {
			throw new UpstreamTransportError(`Stdio upstream '${this.name}': spawn failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (child.stdin === null || child.stdout === null || child.stderr === null) {
			child.kill("SIGKILL");
			throw new UpstreamTransportError(`Stdio upstream '${this.name}': child pipes were not created`);
		}
		this.child = child;
		child.stdin.on("error", () => void 0);
		child.once("error", (error) => {
			this.failPending(`Stdio upstream '${this.name}': spawn failed: ${error.message}`);
		});
		const stderrChunks = [];
		let stderrBytes = 0;
		child.stderr.on("data", (chunk) => {
			if (stderrBytes >= STDERR_CAPTURE_LIMIT) return;
			const remaining = STDERR_CAPTURE_LIMIT - stderrBytes;
			const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
			stderrChunks.push(kept);
			stderrBytes += kept.length;
		});
		this.readerDone = this.readerLoop(new StdoutReader(child.stdout), child, stderrChunks);
		await this.handshake();
		if (this.child === child) this.ready = true;
	}
	/**
	* MCP initialize + notifications/initialized. The reader loop is already
	* draining stdout, so the initialize response is dispatched through
	* {@link pending} instead of read inline.
	*/
	async handshake() {
		const id = this.nextId();
		const frame = `${JSON.stringify({
			jsonrpc: "2.0",
			id,
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: {
					name: "mcpp",
					version: "0.1.0"
				}
			}
		})}\n`;
		await this.request(id, frame);
		await this.writeFrame(`${JSON.stringify({
			jsonrpc: "2.0",
			method: "notifications/initialized",
			params: {}
		})}\n`);
	}
	/** Allocate the next request id, starting at 1 for every spawned child. */
	nextId() {
		this.requestId += 1;
		return this.requestId;
	}
	/**
	* Run one JSON-RPC call over the live child.
	* @param method - JSON-RPC method name.
	* @param params - request params.
	* @returns the full JSON-RPC response message.
	*/
	async rpc(method, params) {
		await this.ensureProcess();
		const id = this.nextId();
		const frame = `${JSON.stringify({
			jsonrpc: "2.0",
			id,
			method,
			params
		})}\n`;
		return await this.request(id, frame);
	}
	/**
	* Register a response slot, write the frame, and wait for the reader (or the
	* read timeout) to settle it.
	* @param id - request id the reader dispatches on.
	* @param frame - complete wire frame, including its trailing newline.
	* @returns the full JSON-RPC response message.
	*/
	async request(id, frame) {
		const result = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new UpstreamTransportError(`Stdio upstream '${this.name}': read timeout after ${this.readTimeout}s`));
			}, this.readTimeout * 1e3);
			this.pending.set(id, {
				resolve: (message) => {
					clearTimeout(timer);
					resolve(message);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				}
			});
		});
		result.catch(() => void 0);
		try {
			await this.writeFrame(frame);
		} catch (error) {
			const pending = this.pending.get(id);
			if (pending !== void 0) {
				this.pending.delete(id);
				pending.reject(error instanceof Error ? error : new Error(String(error)));
			}
		}
		return await result;
	}
	/**
	* Queue one complete frame for stdin, respecting backpressure so the buffer
	* is only written out before the next frame is appended.
	* @param frame - complete wire frame.
	*/
	async writeFrame(frame) {
		const next = this.writeQueue.then(async () => await this.writeNow(frame));
		this.writeQueue = next.then(() => void 0, () => void 0);
		await next;
	}
	/**
	* Write one frame to stdin, waiting for `drain` when the kernel buffer is full.
	* @param frame - complete wire frame.
	*/
	writeNow(frame) {
		return new Promise((resolve, reject) => {
			const writable = this.child?.stdin;
			if (writable === null || writable === void 0) {
				reject(new UpstreamTransportError(`Stdio upstream '${this.name}': stdin is not writable`));
				return;
			}
			if (writable.destroyed) {
				reject(new UpstreamTransportError(`Stdio upstream '${this.name}': stdin is closed`));
				return;
			}
			let settled = false;
			const cleanup = () => {
				writable.removeListener("drain", onDrain);
				writable.removeListener("error", onError);
				writable.removeListener("close", onClose);
			};
			const finish = (error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (error !== void 0) reject(error);
				else resolve();
			};
			const onDrain = () => {
				finish();
			};
			const onError = (error) => {
				finish(new UpstreamTransportError(`Stdio upstream '${this.name}': stdin write failed: ${error.message}`));
			};
			const onClose = () => {
				finish(new UpstreamTransportError(`Stdio upstream '${this.name}': stdin closed`));
			};
			writable.on("drain", onDrain);
			writable.on("error", onError);
			writable.on("close", onClose);
			let accepted;
			try {
				accepted = writable.write(frame);
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			if (accepted) finish();
		});
	}
	/**
	* Drain stdout for the lifetime of one child, dispatching each frame to the
	* caller waiting on its request id. EOF fails every still-pending caller and
	* clears readiness so the next call respawns.
	* @param reader - buffered stdout of this child.
	* @param child - the child this reader belongs to.
	* @param stderrChunks - stderr captured so far, reported in the EOF message.
	*/
	async readerLoop(reader, child, stderrChunks) {
		try {
			for (;;) {
				const frame = await this.readFrame(reader);
				if (frame === null) break;
				this.dispatchFrame(frame);
			}
		} catch {} finally {
			if (this.child === child) {
				await this.waitForExit(child, EXIT_REPORT_WAIT_MS);
				const exitCode = this.exitLabel(child);
				const stderrTail = Buffer.concat(stderrChunks).toString("utf8").slice(0, 500);
				const base = `Stdio upstream '${this.name}': stream closed (exit code ${exitCode})`;
				this.failPending(stderrTail === "" ? base : `${base}. stderr: ${stderrTail}`);
				this.ready = false;
				this.readerDone = null;
			}
		}
	}
	/**
	* Read one JSON-RPC frame in either supported wire format.
	* @param reader - buffered stdout of the current child.
	* @returns the JSON text, or null on EOF.
	*/
	async readFrame(reader) {
		const first = await reader.readLine();
		if (first === null) return null;
		const stripped = first.trim();
		if (stripped.toLowerCase().startsWith("content-length:")) {
			const rawLength = stripped.slice(15).trim();
			const length = Number(rawLength);
			if (!Number.isInteger(length) || length < 0) throw new Error(`invalid Content-Length header: ${rawLength}`);
			for (;;) {
				const header = await reader.readLine();
				if (header === null) throw new Error("stdio stream ended inside a Content-Length header block");
				if (header.trim() === "") break;
			}
			return (await reader.readExactly(length)).toString("utf8");
		}
		return first;
	}
	/**
	* Hand one decoded frame to the caller waiting on its id; frames without a
	* matching pending request are unsolicited notifications or late responses
	* for a timed-out call, and are dropped.
	* @param frame - one decoded frame of JSON text.
	*/
	dispatchFrame(frame) {
		let parsed;
		try {
			parsed = JSON.parse(frame);
		} catch {
			return;
		}
		if (!isJsonObject$1(parsed)) return;
		const id = parsed["id"];
		if (typeof id !== "number") return;
		const pending = this.pending.get(id);
		if (pending === void 0) return;
		this.pending.delete(id);
		if ("error" in parsed) pending.reject(new UpstreamRpcError(`Upstream '${this.name}' JSON-RPC error: ${rpcErrorMessage$1(parsed["error"])}`));
		else pending.resolve(parsed);
	}
	/**
	* Reject every pending caller with one message.
	* @param message - failure description handed to each caller.
	*/
	failPending(message) {
		const pending = [...this.pending.values()];
		this.pending.clear();
		for (const call of pending) call.reject(new UpstreamTransportError(message));
	}
	/**
	* Terminate a live child that outlived its reader, so the next spawn starts
	* from a clean process table.
	*/
	async reapLingeringChild() {
		const child = this.child;
		if (child === null) return;
		if (child.exitCode !== null || child.signalCode !== null) return;
		this.signalChild(child, false);
		if (!await this.waitForExit(child, TERMINATE_GRACE_MS)) {
			this.signalChild(child, true);
			await this.waitForExit(child, TERMINATE_GRACE_MS);
		}
	}
	/**
	* Deliver a terminate (or, with `force`, a kill) to the child.
	* @param child - child to signal.
	* @param force - send `SIGKILL` instead of `SIGTERM`.
	*/
	signalChild(child, force) {
		if (child.exitCode !== null || child.signalCode !== null) return;
		try {
			child.kill(force ? "SIGKILL" : "SIGTERM");
		} catch {}
	}
	/**
	* Wait for a child to exit.
	* @param child - child to observe.
	* @param timeoutMs - how long to wait before reporting it did not exit.
	* @returns true when the child exited, false on timeout.
	*/
	waitForExit(child, timeoutMs) {
		if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
		return new Promise((resolve) => {
			let timer;
			const done = (exited) => {
				child.removeListener("exit", onExit);
				child.removeListener("close", onClose);
				if (timer !== void 0) clearTimeout(timer);
				resolve(exited);
			};
			const onExit = () => {
				done(true);
			};
			const onClose = () => {
				done(true);
			};
			child.once("exit", onExit);
			child.once("close", onClose);
			timer = setTimeout(() => {
				done(false);
			}, timeoutMs);
		});
	}
	/**
	* Render the child's termination status for the EOF message.
	* @param child - child whose status is reported.
	* @returns exit code, signal name, or `'n/a'`.
	*/
	exitLabel(child) {
		if (child.exitCode !== null) return String(child.exitCode);
		if (child.signalCode !== null) return String(child.signalCode);
		return "n/a";
	}
	/** Await the current reader loop, bounded so a wedged child cannot hang close. */
	async awaitReader() {
		const done = this.readerDone;
		if (done === null) return;
		let timer;
		await Promise.race([done, new Promise((resolve) => {
			timer = setTimeout(() => {
				resolve();
			}, TERMINATE_GRACE_MS);
		})]);
		if (timer !== void 0) clearTimeout(timer);
	}
	/** Build the child environment from the inherit whitelist plus explicit vars. */
	mergedEnv() {
		const env = {};
		for (const key of this.inheritEnv) {
			const value = process.env[key];
			if (value !== void 0) env[key] = value;
		}
		for (const [key, value] of Object.entries(this.extraEnv)) env[key] = value;
		return env;
	}
};
//#endregion
//#region src/upstream-http.ts
/**
* HTTP upstream transport: JSON-RPC over the MCP Streamable HTTP framing,
* including the initialize handshake, session recovery, and one retry after a
* transport-level failure.
*
* The retired service used httpx; here the connection pool is a per-transport
* `keepAlive` agent. Recovering destroys that agent and builds a fresh one,
* which drops every pooled socket exactly like rebuilding the httpx client did.
*
* Owner: upstream. Contract: DESIGN.md § src/upstream-http.ts and
* the retired service's `upstream.py:74-271`.
*
* @module
*/
/** Seconds allowed for the TCP/TLS connection before the request fails. */
const DEFAULT_CONNECT_TIMEOUT = 30;
/** Seconds allowed from sending the request until the response body ends. */
const DEFAULT_READ_TIMEOUT = 120;
/**
* Extract the first JSON-RPC object from an SSE body. Consecutive `data:` lines
* belong to one event and are joined with newlines; a trailing event without a
* blank-line terminator still flushes.
* @param text - raw response body.
* @returns the parsed object, or null when no data event parses.
*/
function parseSseJson(text) {
	let dataLines = [];
	const flush = () => {
		if (dataLines.length === 0) return null;
		const blob = dataLines.join("\n");
		dataLines = [];
		try {
			const parsed = JSON.parse(blob);
			return isJsonObject(parsed) ? parsed : null;
		} catch {
			return null;
		}
	};
	for (const line of text.split(/\r\n|\r|\n/)) if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^\s+/, ""));
	else if (line.trim() === "" && dataLines.length > 0) {
		const parsed = flush();
		if (parsed !== null) return parsed;
	}
	return flush();
}
/**
* Report whether an untrusted JSON value is a JSON object (not null, not an array).
* @param value - value to inspect.
* @returns true when `value` is a non-null, non-array object.
*/
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Read one header value out of Node's decoded response headers.
* @param value - raw header value.
* @returns the first value, or undefined when the header is absent.
*/
function headerValue(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value[0];
}
/**
* Render the `message` of a JSON-RPC `error` member.
* @param value - the untrusted `error` member.
* @returns its message, or `'unknown'` when there is none.
*/
function rpcErrorMessage(value) {
	if (isJsonObject(value)) {
		const message = value["message"];
		if (typeof message === "string") return message;
	}
	return "unknown";
}
/**
* Project one untrusted wire tool into the gateway's `Tool` type; unknown
* members are dropped, mirroring the retired service's pydantic model.
* @param value - one entry of a `tools/list` result.
* @returns the tool, or null when the entry is not an object with a string name.
*/
function toTool(value) {
	if (!isJsonObject(value)) return null;
	const name = value["name"];
	if (typeof name !== "string") return null;
	const tool = { name };
	const description = value["description"];
	if (typeof description === "string") tool.description = description;
	const inputSchema = value["inputSchema"];
	if (isJsonObject(inputSchema)) tool.inputSchema = inputSchema;
	const annotations = value["annotations"];
	if (isJsonObject(annotations)) tool.annotations = annotations;
	const title = value["title"];
	if (typeof title === "string") tool.title = title;
	return tool;
}
/** One Streamable-HTTP upstream connection. */
var HttpTransport = class {
	name;
	/** Resolved MCP endpoint (`/mcp` appended only when the URL lacks it). */
	endpoint;
	getAuth;
	/** Connect timeout in seconds. */
	connectTimeout;
	/** Read timeout in seconds. */
	readTimeout;
	/** Keep-alive pool; replaced wholesale by {@link recoverConnection}. */
	agent;
	sessionId = null;
	requestId = 0;
	closed = false;
	/** @param options - endpoint, auth resolver, and timeouts. */
	constructor(options) {
		this.name = options.name;
		const base = options.url.replace(/\/+$/, "");
		const resolved = base.toLowerCase().includes("/mcp") ? base : `${base}/mcp`;
		this.endpoint = new URL(resolved);
		this.getAuth = options.getAuth;
		this.connectTimeout = options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
		this.readTimeout = options.readTimeout ?? DEFAULT_READ_TIMEOUT;
		this.agent = this.newAgent();
	}
	/** Fetch the upstream tool list (raw). */
	async listTools() {
		const result = (await this.rpc("tools/list", void 0))["result"];
		if (!isJsonObject(result)) return [];
		const tools = result["tools"];
		if (!Array.isArray(tools)) return [];
		const projected = [];
		for (const entry of tools) {
			const tool = toTool(entry);
			if (tool !== null) projected.push(tool);
		}
		return projected;
	}
	/** Invoke one upstream tool and return its JSON-RPC `result`. */
	async callTool(name, args) {
		const result = (await this.rpc("tools/call", {
			name,
			arguments: args
		}))["result"];
		return isJsonObject(result) ? result : {};
	}
	/** Release the connection pool. Idempotent. */
	async close() {
		if (this.closed) return;
		this.closed = true;
		this.sessionId = null;
		this.agent.destroy();
	}
	/** Build a keep-alive pool appropriate for the endpoint's protocol. */
	newAgent() {
		return this.endpoint.protocol === "https:" ? new Agent$1({ keepAlive: true }) : new Agent({ keepAlive: true });
	}
	/**
	* Discard the cached session and rebuild the keep-alive pool, dropping every
	* pooled socket. Used after a transport-level failure, where those sockets
	* cannot be trusted and an upstream may signal a stale session by dropping
	* the connection instead of answering 404.
	*/
	recoverConnection() {
		this.sessionId = null;
		try {
			this.agent.destroy();
		} catch {}
		this.agent = this.newAgent();
	}
	/** Allocate the next request id, starting at 1 like the retired service. */
	nextId() {
		this.requestId += 1;
		return this.requestId;
	}
	/** Headers for one outbound request; auth is resolved fresh on every call. */
	headers(withSession) {
		const headers = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream"
		};
		if (withSession && this.sessionId !== null) headers["MCP-Session-Id"] = this.sessionId;
		if (this.getAuth !== void 0) {
			const authHeaders = this.getAuth();
			if (authHeaders !== void 0) Object.assign(headers, authHeaders);
		}
		return headers;
	}
	/**
	* Run the MCP initialize handshake once and cache the session id.
	*
	* Streamable-HTTP servers require initialize → (capture session id) →
	* notifications/initialized; subsequent requests then carry MCP-Session-Id.
	*/
	async ensureSession() {
		if (this.sessionId !== null) return;
		const payload = {
			jsonrpc: "2.0",
			id: this.nextId(),
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: {
					name: "mcpp",
					version: "0.1.0"
				}
			}
		};
		const response = await this.send(payload, false);
		if (response.status !== 200) throw new UpstreamHttpError(`Upstream '${this.name}' initialize returned ${response.status}`, response.status);
		const sessionId = headerValue(response.headers["mcp-session-id"]);
		if (sessionId === void 0 || sessionId === "") return;
		this.sessionId = sessionId;
		await this.send({
			jsonrpc: "2.0",
			method: "notifications/initialized",
			params: {}
		}, true);
	}
	/** One POST with a JSON body, fully read. */
	send(payload, withSession) {
		if (this.closed) return Promise.reject(new UpstreamTransportError(`Upstream '${this.name}': transport is closed`));
		return new Promise((resolve, reject) => {
			const body = JSON.stringify(payload);
			let settled = false;
			let readTimer;
			let request$2 = null;
			const clearReadTimer = () => {
				if (readTimer !== void 0) {
					clearTimeout(readTimer);
					readTimer = void 0;
				}
			};
			const fail = (error) => {
				if (settled) return;
				settled = true;
				clearReadTimer();
				request$2?.destroy();
				reject(error);
			};
			const succeed = (response) => {
				if (settled) return;
				settled = true;
				clearReadTimer();
				resolve(response);
			};
			const onResponse = (response) => {
				if (settled) return;
				request$2?.socket?.setTimeout(0);
				const chunks = [];
				response.on("data", (chunk) => {
					chunks.push(chunk);
				});
				response.on("end", () => {
					succeed({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks).toString("utf8")
					});
				});
				response.on("error", (error) => {
					fail(this.transportError(`response failed: ${error.message}`));
				});
				response.on("aborted", () => {
					fail(this.transportError("response was aborted"));
				});
			};
			const options = {
				method: "POST",
				headers: this.headers(withSession),
				agent: this.agent
			};
			request$2 = this.endpoint.protocol === "https:" ? request$1(this.endpoint, options, onResponse) : request(this.endpoint, options, onResponse);
			request$2.setTimeout(this.connectTimeout * 1e3, () => {
				fail(this.transportError(`connect timeout after ${this.connectTimeout}s`));
			});
			request$2.on("socket", (assigned) => {
				if (!assigned.connecting) {
					assigned.setTimeout(0);
					return;
				}
				const clearConnectTimer = () => {
					assigned.setTimeout(0);
					assigned.removeListener("connect", clearConnectTimer);
					assigned.removeListener("secureConnect", clearConnectTimer);
				};
				assigned.once("connect", clearConnectTimer);
				assigned.once("secureConnect", clearConnectTimer);
			});
			request$2.on("error", (error) => {
				fail(this.transportError(error.message));
			});
			readTimer = setTimeout(() => {
				fail(this.transportError(`read timeout after ${this.readTimeout}s`));
			}, this.readTimeout * 1e3);
			request$2.end(body);
		});
	}
	/**
	* Build a transport-level failure carrying the `Upstream '<name>'` prefix.
	* @param detail - what failed, e.g. `connect timeout after 30s`.
	* @returns the typed failure.
	*/
	transportError(detail) {
		return new UpstreamTransportError(`Upstream '${this.name}' transport error: ${detail}`);
	}
	/**
	* POST one JSON-RPC request, retrying once on a transport failure or a 404
	* for a cached session. HTTP errors are real answers and are not retried.
	* @param method - JSON-RPC method name.
	* @param params - request params, or undefined for `{}`.
	* @returns the fully read HTTP response.
	*/
	async postRpc(method, params) {
		if (this.closed) throw new UpstreamTransportError(`Upstream '${this.name}': transport is closed`);
		for (let attempt = 0;; attempt += 1) {
			await this.ensureSession();
			const payload = {
				jsonrpc: "2.0",
				id: this.nextId(),
				method,
				params: params ?? {}
			};
			try {
				const response = await this.send(payload, true);
				if (response.status === 404 && attempt === 0 && this.sessionId !== null) {
					this.sessionId = null;
					continue;
				}
				return response;
			} catch (error) {
				if (error instanceof UpstreamTransportError && attempt === 0) {
					this.recoverConnection();
					continue;
				}
				throw error;
			}
		}
	}
	/**
	* Run one JSON-RPC call and decode its response body.
	* @param method - JSON-RPC method name.
	* @param params - request params, or undefined for `{}`.
	* @returns the decoded JSON-RPC response object.
	*/
	async rpc(method, params) {
		const response = await this.postRpc(method, params);
		if (response.status !== 200) throw new UpstreamHttpError(`Upstream '${this.name}' returned ${response.status}`, response.status);
		const data = this.decodeBody(response);
		if ("error" in data) throw new UpstreamRpcError(`Upstream '${this.name}' JSON-RPC error: ${rpcErrorMessage(data["error"])}`);
		return data;
	}
	/**
	* Decode a 200 response body according to its content type.
	* @param response - fully read response.
	* @returns the decoded JSON-RPC object.
	*/
	decodeBody(response) {
		const contentType = headerValue(response.headers["content-type"]) ?? "";
		if (contentType.startsWith("application/json")) return this.parseJsonBody(response.body);
		if (contentType.startsWith("text/event-stream")) {
			const data = parseSseJson(response.body);
			if (data === null) throw new UpstreamTransportError(`Upstream '${this.name}': SSE stream had no JSON-RPC response`);
			return data;
		}
		try {
			return this.parseJsonBody(response.body);
		} catch {
			throw new UpstreamHttpError(`Upstream '${this.name}': unsupported content-type '${contentType}'`, response.status);
		}
	}
	/**
	* Parse a response body expected to be one JSON object.
	* @param body - raw response text.
	* @returns the parsed object.
	*/
	parseJsonBody(body) {
		let parsed;
		try {
			parsed = JSON.parse(body);
		} catch {
			throw new UpstreamTransportError(`Upstream '${this.name}': response body is not valid JSON`);
		}
		if (!isJsonObject(parsed)) throw new UpstreamTransportError(`Upstream '${this.name}': response body is not a JSON object`);
		return parsed;
	}
};
//#endregion
//#region src/bootstrap.ts
/**
* Composition root: loads the YAML configuration, builds one transport per
* upstream, assembles the dependency objects the HTTP layers receive, and owns
* the reload path (validate -> persist -> rebuild -> swap).
*
* @module
*/
/** Atomic whole-file replace: the admin editor must never truncate a config on crash. */
function writeFileAtomic(path, text) {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, text, "utf8");
	renameSync(temporary, path);
}
/**
* Build the transport for one upstream config.
* @param upstream - upstream definition.
* @param keypools - live pools; a pool with the upstream's name drives its auth.
* @param logger - sink for credential exhaustion.
* @param env - environment for `${VAR}` resolution.
* @returns the transport (connections open lazily).
*/
function createTransport(upstream, keypools, logger, env) {
	if (upstream.transport === "stdio") {
		const resolvedEnv = Object.fromEntries(Object.entries(upstream.env ?? {}).map(([key, value]) => [key, resolveEnvValue(value, env)]));
		return new StdioTransport({
			name: upstream.name,
			command: upstream.command ?? "",
			args: upstream.args ?? [],
			env: resolvedEnv,
			inheritEnv: upstream.inheritEnv,
			readTimeout: upstream.readTimeout
		});
	}
	const auth = upstream.auth;
	const pool = keypools.get(upstream.name);
	const getAuth = auth === void 0 || pool === void 0 ? void 0 : () => {
		try {
			return { [auth.header]: `${auth.scheme}${pool.next()}` };
		} catch {
			logger.error(`Upstream '${upstream.name}': all keys exhausted`);
			return;
		}
	};
	return new HttpTransport({
		name: upstream.name,
		url: upstream.url ?? "",
		getAuth,
		connectTimeout: upstream.connectTimeout,
		readTimeout: upstream.readTimeout
	});
}
/**
* Create the gateway from a configuration file. Nothing binds until {@link GatewayHandle.start}.
* @param options - config path, bind address, environment, logger.
* @returns the live handle.
* @throws ConfigError when the configuration cannot be read or validated.
*/
function createGateway(options) {
	const env = options.env ?? process.env;
	const logger = options.logger ?? createLogger();
	const config = loadConfigFile(options.configPath, env);
	const runtime = {
		configPath: options.configPath,
		config,
		upstreams: /* @__PURE__ */ new Map(),
		keypools: /* @__PURE__ */ new Map(),
		callLog: [],
		logger
	};
	/** (Re)build every transport and key pool into the live maps, in place. */
	const buildUpstreams = () => {
		runtime.upstreams.clear();
		runtime.keypools.clear();
		for (const upstream of runtime.config.upstreams) {
			if (upstream.auth !== void 0 && upstream.auth.keys.length > 0) {
				const keys = upstream.auth.keys.map((key) => resolveEnvValue(key, env));
				runtime.keypools.set(upstream.name, new KeyPool(keys));
				logger.info(`Upstream '${upstream.name}': keypool with ${keys.length} keys`);
			} else logger.info(`Upstream '${upstream.name}': no auth`);
			runtime.upstreams.set(upstream.name, createTransport(upstream, runtime.keypools, logger, env));
		}
	};
	buildUpstreams();
	const recordCall = (entry) => {
		runtime.callLog.push(entry);
		if (runtime.callLog.length > 200) runtime.callLog.shift();
	};
	const mcpDeps = {
		config: () => runtime.config,
		transport: (name) => runtime.upstreams.get(name),
		recordCall,
		onUpstreamStatus: (upstreamName, status) => {
			if (status !== 401 && status !== 403 && status !== 429) return;
			const pool = runtime.keypools.get(upstreamName);
			if (pool === void 0) return;
			pool.markBad(pool.current);
			logger.warn(`Upstream '${upstreamName}': key marked bad after ${status}, ${pool.healthyCount} healthy remaining`);
		},
		logger
	};
	const adminDeps = {
		...mcpDeps,
		configPath: options.configPath,
		keypool: (name) => runtime.keypools.get(name),
		keypools: () => runtime.keypools,
		callLogSnapshot: () => [...runtime.callLog],
		createProbeTransport: (upstream) => {
			const pools = /* @__PURE__ */ new Map();
			if (upstream.auth !== void 0 && upstream.auth.keys.length > 0) pools.set(upstream.name, new KeyPool(upstream.auth.keys.map((key) => resolveEnvValue(key, env))));
			return createTransport(upstream, pools, logger, env);
		},
		persistConfig: async (next) => {
			const text = dumpConfig(next);
			writeFileAtomic(options.configPath, text);
			logger.info(`Config written to ${options.configPath}, reloading`);
			const reparsed = parseConfig(text, env);
			const stale = [...runtime.upstreams.values()];
			runtime.config = reparsed;
			buildUpstreams();
			await Promise.allSettled(stale.map(async (transport) => transport.close()));
		}
	};
	const server = createHttpServer({
		host: options.host,
		port: options.port,
		runtime,
		mcp: mcpDeps,
		admin: adminDeps,
		logger,
		env,
		adminHtmlPath: fileURLToPath(new URL("../static/index.html", import.meta.url))
	});
	/** Spawn + handshake stdio upstreams so the first client probe does not pay cold start. */
	const prewarmStdio = async () => {
		const stdio = [...runtime.upstreams.values()].filter((transport) => transport instanceof StdioTransport);
		if (stdio.length === 0) return;
		let timer;
		try {
			await Promise.race([Promise.allSettled(stdio.map(async (transport) => transport.ensureProcess())), new Promise((resolve) => {
				timer = setTimeout(resolve, 20 * 1e3);
			})]);
		} finally {
			if (timer !== void 0) clearTimeout(timer);
		}
		await Promise.allSettled(stdio.map(async (transport) => transport.closeIfUnready()));
	};
	let closed = false;
	return {
		runtime,
		configPath: options.configPath,
		address() {
			return server.address;
		},
		async start() {
			const address = await server.start();
			await prewarmStdio();
			logger.info(`mcpp gateway listening at http://${address.host}:${address.port} (config: ${options.configPath}, ${runtime.config.upstreams.length} upstreams)`);
			return address;
		},
		async close() {
			if (closed) return;
			closed = true;
			await server.close();
			await Promise.allSettled([...runtime.upstreams.values()].map(async (transport) => transport.close()));
			for (const transport of runtime.upstreams.values()) if (transport instanceof StdioTransport) transport.killNowait();
			runtime.upstreams.clear();
			runtime.keypools.clear();
		}
	};
}
//#endregion
//#region src/plugin.ts
/**
* Cordis plugin entry for the mcpp gateway.
*
* One row in a profile's `cordis.patch.yml` starts one gateway listener. The
* plugin owns no configuration of its own beyond where the retired service's
* YAML lives and what it binds: every upstream, expose entry, naming mode, and
* gateway token still comes from that document, so the two implementations are
* interchangeable without touching a single client configuration.
*
* @module
*/
/** Plugin name used by loader diagnostics. */
const name = "mcpp";
/** Plugin configuration, editable from the profile's `cordis.patch.yml`. */
const Config = z.object({
	/** Absolute path of the mcpp `config.yaml` this gateway serves. */
	configPath: z.string().required().description("Path of the mcpp YAML configuration to serve"),
	/** Listen address; keep it on loopback unless the network is trusted. */
	host: z.string().default("127.0.0.1").description("Listen address for the MCP endpoints"),
	/** Listen port shared with the retired service, so client configs keep working. */
	port: z.natural().max(65535).default(9020).description("Listen port")
});
/**
* Start the gateway for this profile and release it on disposal.
* @param ctx - plugin context.
* @param config - validated plugin configuration.
* @returns activation readiness: the listener is bound when this resolves.
*/
async function apply(ctx, config) {
	const gateway = createGateway({
		configPath: config.configPath,
		host: config.host,
		port: config.port,
		logger: {
			info: (message) => {
				ctx.logger.info(message);
			},
			warn: (message) => {
				ctx.logger.warn(message);
			},
			error: (message) => {
				ctx.logger.error(message);
			}
		}
	});
	await ctx.effect(async () => {
		try {
			await gateway.start();
		} catch (error) {
			await gateway.close();
			throw error;
		}
		return async () => {
			await gateway.close();
		};
	}, "mcpp.gateway");
}
//#endregion
export { Config, apply, name };
