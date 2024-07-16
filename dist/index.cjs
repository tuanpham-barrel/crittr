'use strict';

var node_module = require('node:module');
var util = require('util');
var path = require('path');
var readline = require('readline');
var process$1 = require('node:process');
var os = require('node:os');
var tty = require('node:tty');
var stream = require('stream');
var url = require('url');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
const ANSI_BACKGROUND_OFFSET = 10;

const wrapAnsi16 = (offset = 0) => code => `\u001B[${code + offset}m`;

const wrapAnsi256 = (offset = 0) => code => `\u001B[${38 + offset};5;${code}m`;

const wrapAnsi16m = (offset = 0) => (red, green, blue) => `\u001B[${38 + offset};2;${red};${green};${blue}m`;

const styles$1 = {
	modifier: {
		reset: [0, 0],
		// 21 isn't widely supported and 22 does the same thing
		bold: [1, 22],
		dim: [2, 22],
		italic: [3, 23],
		underline: [4, 24],
		overline: [53, 55],
		inverse: [7, 27],
		hidden: [8, 28],
		strikethrough: [9, 29],
	},
	color: {
		black: [30, 39],
		red: [31, 39],
		green: [32, 39],
		yellow: [33, 39],
		blue: [34, 39],
		magenta: [35, 39],
		cyan: [36, 39],
		white: [37, 39],

		// Bright color
		blackBright: [90, 39],
		gray: [90, 39], // Alias of `blackBright`
		grey: [90, 39], // Alias of `blackBright`
		redBright: [91, 39],
		greenBright: [92, 39],
		yellowBright: [93, 39],
		blueBright: [94, 39],
		magentaBright: [95, 39],
		cyanBright: [96, 39],
		whiteBright: [97, 39],
	},
	bgColor: {
		bgBlack: [40, 49],
		bgRed: [41, 49],
		bgGreen: [42, 49],
		bgYellow: [43, 49],
		bgBlue: [44, 49],
		bgMagenta: [45, 49],
		bgCyan: [46, 49],
		bgWhite: [47, 49],

		// Bright color
		bgBlackBright: [100, 49],
		bgGray: [100, 49], // Alias of `bgBlackBright`
		bgGrey: [100, 49], // Alias of `bgBlackBright`
		bgRedBright: [101, 49],
		bgGreenBright: [102, 49],
		bgYellowBright: [103, 49],
		bgBlueBright: [104, 49],
		bgMagentaBright: [105, 49],
		bgCyanBright: [106, 49],
		bgWhiteBright: [107, 49],
	},
};

Object.keys(styles$1.modifier);
const foregroundColorNames = Object.keys(styles$1.color);
const backgroundColorNames = Object.keys(styles$1.bgColor);
[...foregroundColorNames, ...backgroundColorNames];

function assembleStyles() {
	const codes = new Map();

	for (const [groupName, group] of Object.entries(styles$1)) {
		for (const [styleName, style] of Object.entries(group)) {
			styles$1[styleName] = {
				open: `\u001B[${style[0]}m`,
				close: `\u001B[${style[1]}m`,
			};

			group[styleName] = styles$1[styleName];

			codes.set(style[0], style[1]);
		}

		Object.defineProperty(styles$1, groupName, {
			value: group,
			enumerable: false,
		});
	}

	Object.defineProperty(styles$1, 'codes', {
		value: codes,
		enumerable: false,
	});

	styles$1.color.close = '\u001B[39m';
	styles$1.bgColor.close = '\u001B[49m';

	styles$1.color.ansi = wrapAnsi16();
	styles$1.color.ansi256 = wrapAnsi256();
	styles$1.color.ansi16m = wrapAnsi16m();
	styles$1.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
	styles$1.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
	styles$1.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);

	// From https://github.com/Qix-/color-convert/blob/3f0e0d4e92e235796ccb17f6e85c72094a651f49/conversions.js
	Object.defineProperties(styles$1, {
		rgbToAnsi256: {
			value(red, green, blue) {
				// We use the extended greyscale palette here, with the exception of
				// black and white. normal palette only has 4 greyscale shades.
				if (red === green && green === blue) {
					if (red < 8) {
						return 16;
					}

					if (red > 248) {
						return 231;
					}

					return Math.round(((red - 8) / 247) * 24) + 232;
				}

				return 16
					+ (36 * Math.round(red / 255 * 5))
					+ (6 * Math.round(green / 255 * 5))
					+ Math.round(blue / 255 * 5);
			},
			enumerable: false,
		},
		hexToRgb: {
			value(hex) {
				const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
				if (!matches) {
					return [0, 0, 0];
				}

				let [colorString] = matches;

				if (colorString.length === 3) {
					colorString = [...colorString].map(character => character + character).join('');
				}

				const integer = Number.parseInt(colorString, 16);

				return [
					/* eslint-disable no-bitwise */
					(integer >> 16) & 0xFF,
					(integer >> 8) & 0xFF,
					integer & 0xFF,
					/* eslint-enable no-bitwise */
				];
			},
			enumerable: false,
		},
		hexToAnsi256: {
			value: hex => styles$1.rgbToAnsi256(...styles$1.hexToRgb(hex)),
			enumerable: false,
		},
		ansi256ToAnsi: {
			value(code) {
				if (code < 8) {
					return 30 + code;
				}

				if (code < 16) {
					return 90 + (code - 8);
				}

				let red;
				let green;
				let blue;

				if (code >= 232) {
					red = (((code - 232) * 10) + 8) / 255;
					green = red;
					blue = red;
				} else {
					code -= 16;

					const remainder = code % 36;

					red = Math.floor(code / 36) / 5;
					green = Math.floor(remainder / 6) / 5;
					blue = (remainder % 6) / 5;
				}

				const value = Math.max(red, green, blue) * 2;

				if (value === 0) {
					return 30;
				}

				// eslint-disable-next-line no-bitwise
				let result = 30 + ((Math.round(blue) << 2) | (Math.round(green) << 1) | Math.round(red));

				if (value === 2) {
					result += 60;
				}

				return result;
			},
			enumerable: false,
		},
		rgbToAnsi: {
			value: (red, green, blue) => styles$1.ansi256ToAnsi(styles$1.rgbToAnsi256(red, green, blue)),
			enumerable: false,
		},
		hexToAnsi: {
			value: hex => styles$1.ansi256ToAnsi(styles$1.hexToAnsi256(hex)),
			enumerable: false,
		},
	});

	return styles$1;
}

const ansiStyles = assembleStyles();

// From: https://github.com/sindresorhus/has-flag/blob/main/index.js
/// function hasFlag(flag, argv = globalThis.Deno?.args ?? process.argv) {
function hasFlag(flag, argv = globalThis.Deno ? globalThis.Deno.args : process$1.argv) {
	const prefix = flag.startsWith('-') ? '' : (flag.length === 1 ? '-' : '--');
	const position = argv.indexOf(prefix + flag);
	const terminatorPosition = argv.indexOf('--');
	return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
}

const {env} = process$1;

let flagForceColor;
if (
	hasFlag('no-color')
	|| hasFlag('no-colors')
	|| hasFlag('color=false')
	|| hasFlag('color=never')
) {
	flagForceColor = 0;
} else if (
	hasFlag('color')
	|| hasFlag('colors')
	|| hasFlag('color=true')
	|| hasFlag('color=always')
) {
	flagForceColor = 1;
}

function envForceColor() {
	if ('FORCE_COLOR' in env) {
		if (env.FORCE_COLOR === 'true') {
			return 1;
		}

		if (env.FORCE_COLOR === 'false') {
			return 0;
		}

		return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
	}
}

function translateLevel(level) {
	if (level === 0) {
		return false;
	}

	return {
		level,
		hasBasic: true,
		has256: level >= 2,
		has16m: level >= 3,
	};
}

function _supportsColor(haveStream, {streamIsTTY, sniffFlags = true} = {}) {
	const noFlagForceColor = envForceColor();
	if (noFlagForceColor !== undefined) {
		flagForceColor = noFlagForceColor;
	}

	const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;

	if (forceColor === 0) {
		return 0;
	}

	if (sniffFlags) {
		if (hasFlag('color=16m')
			|| hasFlag('color=full')
			|| hasFlag('color=truecolor')) {
			return 3;
		}

		if (hasFlag('color=256')) {
			return 2;
		}
	}

	// Check for Azure DevOps pipelines.
	// Has to be above the `!streamIsTTY` check.
	if ('TF_BUILD' in env && 'AGENT_NAME' in env) {
		return 1;
	}

	if (haveStream && !streamIsTTY && forceColor === undefined) {
		return 0;
	}

	const min = forceColor || 0;

	if (env.TERM === 'dumb') {
		return min;
	}

	if (process$1.platform === 'win32') {
		// Windows 10 build 10586 is the first Windows release that supports 256 colors.
		// Windows 10 build 14931 is the first release that supports 16m/TrueColor.
		const osRelease = os.release().split('.');
		if (
			Number(osRelease[0]) >= 10
			&& Number(osRelease[2]) >= 10_586
		) {
			return Number(osRelease[2]) >= 14_931 ? 3 : 2;
		}

		return 1;
	}

	if ('CI' in env) {
		if ('GITHUB_ACTIONS' in env || 'GITEA_ACTIONS' in env) {
			return 3;
		}

		if (['TRAVIS', 'CIRCLECI', 'APPVEYOR', 'GITLAB_CI', 'BUILDKITE', 'DRONE'].some(sign => sign in env) || env.CI_NAME === 'codeship') {
			return 1;
		}

		return min;
	}

	if ('TEAMCITY_VERSION' in env) {
		return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
	}

	if (env.COLORTERM === 'truecolor') {
		return 3;
	}

	if (env.TERM === 'xterm-kitty') {
		return 3;
	}

	if ('TERM_PROGRAM' in env) {
		const version = Number.parseInt((env.TERM_PROGRAM_VERSION || '').split('.')[0], 10);

		switch (env.TERM_PROGRAM) {
			case 'iTerm.app': {
				return version >= 3 ? 3 : 2;
			}

			case 'Apple_Terminal': {
				return 2;
			}
			// No default
		}
	}

	if (/-256(color)?$/i.test(env.TERM)) {
		return 2;
	}

	if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
		return 1;
	}

	if ('COLORTERM' in env) {
		return 1;
	}

	return min;
}

function createSupportsColor(stream, options = {}) {
	const level = _supportsColor(stream, {
		streamIsTTY: stream && stream.isTTY,
		...options,
	});

	return translateLevel(level);
}

const supportsColor = {
	stdout: createSupportsColor({isTTY: tty.isatty(1)}),
	stderr: createSupportsColor({isTTY: tty.isatty(2)}),
};

// TODO: When targeting Node.js 16, use `String.prototype.replaceAll`.
function stringReplaceAll(string, substring, replacer) {
	let index = string.indexOf(substring);
	if (index === -1) {
		return string;
	}

	const substringLength = substring.length;
	let endIndex = 0;
	let returnValue = '';
	do {
		returnValue += string.slice(endIndex, index) + substring + replacer;
		endIndex = index + substringLength;
		index = string.indexOf(substring, endIndex);
	} while (index !== -1);

	returnValue += string.slice(endIndex);
	return returnValue;
}

function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
	let endIndex = 0;
	let returnValue = '';
	do {
		const gotCR = string[index - 1] === '\r';
		returnValue += string.slice(endIndex, (gotCR ? index - 1 : index)) + prefix + (gotCR ? '\r\n' : '\n') + postfix;
		endIndex = index + 1;
		index = string.indexOf('\n', endIndex);
	} while (index !== -1);

	returnValue += string.slice(endIndex);
	return returnValue;
}

const {stdout: stdoutColor, stderr: stderrColor} = supportsColor;

const GENERATOR = Symbol('GENERATOR');
const STYLER = Symbol('STYLER');
const IS_EMPTY = Symbol('IS_EMPTY');

// `supportsColor.level` → `ansiStyles.color[name]` mapping
const levelMapping = [
	'ansi',
	'ansi',
	'ansi256',
	'ansi16m',
];

const styles = Object.create(null);

const applyOptions = (object, options = {}) => {
	if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
		throw new Error('The `level` option should be an integer from 0 to 3');
	}

	// Detect level if not set manually
	const colorLevel = stdoutColor ? stdoutColor.level : 0;
	object.level = options.level === undefined ? colorLevel : options.level;
};

const chalkFactory = options => {
	const chalk = (...strings) => strings.join(' ');
	applyOptions(chalk, options);

	Object.setPrototypeOf(chalk, createChalk.prototype);

	return chalk;
};

function createChalk(options) {
	return chalkFactory(options);
}

Object.setPrototypeOf(createChalk.prototype, Function.prototype);

for (const [styleName, style] of Object.entries(ansiStyles)) {
	styles[styleName] = {
		get() {
			const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
			Object.defineProperty(this, styleName, {value: builder});
			return builder;
		},
	};
}

styles.visible = {
	get() {
		const builder = createBuilder(this, this[STYLER], true);
		Object.defineProperty(this, 'visible', {value: builder});
		return builder;
	},
};

const getModelAnsi = (model, level, type, ...arguments_) => {
	if (model === 'rgb') {
		if (level === 'ansi16m') {
			return ansiStyles[type].ansi16m(...arguments_);
		}

		if (level === 'ansi256') {
			return ansiStyles[type].ansi256(ansiStyles.rgbToAnsi256(...arguments_));
		}

		return ansiStyles[type].ansi(ansiStyles.rgbToAnsi(...arguments_));
	}

	if (model === 'hex') {
		return getModelAnsi('rgb', level, type, ...ansiStyles.hexToRgb(...arguments_));
	}

	return ansiStyles[type][model](...arguments_);
};

const usedModels = ['rgb', 'hex', 'ansi256'];

for (const model of usedModels) {
	styles[model] = {
		get() {
			const {level} = this;
			return function (...arguments_) {
				const styler = createStyler(getModelAnsi(model, levelMapping[level], 'color', ...arguments_), ansiStyles.color.close, this[STYLER]);
				return createBuilder(this, styler, this[IS_EMPTY]);
			};
		},
	};

	const bgModel = 'bg' + model[0].toUpperCase() + model.slice(1);
	styles[bgModel] = {
		get() {
			const {level} = this;
			return function (...arguments_) {
				const styler = createStyler(getModelAnsi(model, levelMapping[level], 'bgColor', ...arguments_), ansiStyles.bgColor.close, this[STYLER]);
				return createBuilder(this, styler, this[IS_EMPTY]);
			};
		},
	};
}

const proto = Object.defineProperties(() => {}, {
	...styles,
	level: {
		enumerable: true,
		get() {
			return this[GENERATOR].level;
		},
		set(level) {
			this[GENERATOR].level = level;
		},
	},
});

const createStyler = (open, close, parent) => {
	let openAll;
	let closeAll;
	if (parent === undefined) {
		openAll = open;
		closeAll = close;
	} else {
		openAll = parent.openAll + open;
		closeAll = close + parent.closeAll;
	}

	return {
		open,
		close,
		openAll,
		closeAll,
		parent,
	};
};

const createBuilder = (self, _styler, _isEmpty) => {
	// Single argument is hot path, implicit coercion is faster than anything
	// eslint-disable-next-line no-implicit-coercion
	const builder = (...arguments_) => applyStyle(builder, (arguments_.length === 1) ? ('' + arguments_[0]) : arguments_.join(' '));

	// We alter the prototype because we must return a function, but there is
	// no way to create a function with a different prototype
	Object.setPrototypeOf(builder, proto);

	builder[GENERATOR] = self;
	builder[STYLER] = _styler;
	builder[IS_EMPTY] = _isEmpty;

	return builder;
};

const applyStyle = (self, string) => {
	if (self.level <= 0 || !string) {
		return self[IS_EMPTY] ? '' : string;
	}

	let styler = self[STYLER];

	if (styler === undefined) {
		return string;
	}

	const {openAll, closeAll} = styler;
	if (string.includes('\u001B')) {
		while (styler !== undefined) {
			// Replace any instances already present with a re-opening code
			// otherwise only the part of the string until said closing code
			// will be colored, and the rest will simply be 'plain'.
			string = stringReplaceAll(string, styler.close, styler.open);

			styler = styler.parent;
		}
	}

	// We can move both next actions out of loop, because remaining actions in loop won't have
	// any/visible effect on parts we add here. Close the styling before a linebreak and reopen
	// after next line to fix a bleed issue on macOS: https://github.com/chalk/chalk/pull/92
	const lfIndex = string.indexOf('\n');
	if (lfIndex !== -1) {
		string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
	}

	return openAll + string + closeAll;
};

Object.defineProperties(createChalk.prototype, styles);

const chalk = createChalk();
createChalk({level: stderrColor ? stderrColor.level : 0});

function isUnicodeSupported() {
	if (process$1.platform !== 'win32') {
		return process$1.env.TERM !== 'linux'; // Linux console (kernel)
	}

	return Boolean(process$1.env.WT_SESSION) // Windows Terminal
		|| Boolean(process$1.env.TERMINUS_SUBLIME) // Terminus (<0.2.27)
		|| process$1.env.ConEmuTask === '{cmd::Cmder}' // ConEmu and cmder
		|| process$1.env.TERM_PROGRAM === 'Terminus-Sublime'
		|| process$1.env.TERM_PROGRAM === 'vscode'
		|| process$1.env.TERM === 'xterm-256color'
		|| process$1.env.TERM === 'alacritty'
		|| process$1.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm';
}

const common = {
	circleQuestionMark: '(?)',
	questionMarkPrefix: '(?)',
	square: '█',
	squareDarkShade: '▓',
	squareMediumShade: '▒',
	squareLightShade: '░',
	squareTop: '▀',
	squareBottom: '▄',
	squareLeft: '▌',
	squareRight: '▐',
	squareCenter: '■',
	bullet: '●',
	dot: '․',
	ellipsis: '…',
	pointerSmall: '›',
	triangleUp: '▲',
	triangleUpSmall: '▴',
	triangleDown: '▼',
	triangleDownSmall: '▾',
	triangleLeftSmall: '◂',
	triangleRightSmall: '▸',
	home: '⌂',
	heart: '♥',
	musicNote: '♪',
	musicNoteBeamed: '♫',
	arrowUp: '↑',
	arrowDown: '↓',
	arrowLeft: '←',
	arrowRight: '→',
	arrowLeftRight: '↔',
	arrowUpDown: '↕',
	almostEqual: '≈',
	notEqual: '≠',
	lessOrEqual: '≤',
	greaterOrEqual: '≥',
	identical: '≡',
	infinity: '∞',
	subscriptZero: '₀',
	subscriptOne: '₁',
	subscriptTwo: '₂',
	subscriptThree: '₃',
	subscriptFour: '₄',
	subscriptFive: '₅',
	subscriptSix: '₆',
	subscriptSeven: '₇',
	subscriptEight: '₈',
	subscriptNine: '₉',
	oneHalf: '½',
	oneThird: '⅓',
	oneQuarter: '¼',
	oneFifth: '⅕',
	oneSixth: '⅙',
	oneEighth: '⅛',
	twoThirds: '⅔',
	twoFifths: '⅖',
	threeQuarters: '¾',
	threeFifths: '⅗',
	threeEighths: '⅜',
	fourFifths: '⅘',
	fiveSixths: '⅚',
	fiveEighths: '⅝',
	sevenEighths: '⅞',
	line: '─',
	lineBold: '━',
	lineDouble: '═',
	lineDashed0: '┄',
	lineDashed1: '┅',
	lineDashed2: '┈',
	lineDashed3: '┉',
	lineDashed4: '╌',
	lineDashed5: '╍',
	lineDashed6: '╴',
	lineDashed7: '╶',
	lineDashed8: '╸',
	lineDashed9: '╺',
	lineDashed10: '╼',
	lineDashed11: '╾',
	lineDashed12: '−',
	lineDashed13: '–',
	lineDashed14: '‐',
	lineDashed15: '⁃',
	lineVertical: '│',
	lineVerticalBold: '┃',
	lineVerticalDouble: '║',
	lineVerticalDashed0: '┆',
	lineVerticalDashed1: '┇',
	lineVerticalDashed2: '┊',
	lineVerticalDashed3: '┋',
	lineVerticalDashed4: '╎',
	lineVerticalDashed5: '╏',
	lineVerticalDashed6: '╵',
	lineVerticalDashed7: '╷',
	lineVerticalDashed8: '╹',
	lineVerticalDashed9: '╻',
	lineVerticalDashed10: '╽',
	lineVerticalDashed11: '╿',
	lineDownLeft: '┐',
	lineDownLeftArc: '╮',
	lineDownBoldLeftBold: '┓',
	lineDownBoldLeft: '┒',
	lineDownLeftBold: '┑',
	lineDownDoubleLeftDouble: '╗',
	lineDownDoubleLeft: '╖',
	lineDownLeftDouble: '╕',
	lineDownRight: '┌',
	lineDownRightArc: '╭',
	lineDownBoldRightBold: '┏',
	lineDownBoldRight: '┎',
	lineDownRightBold: '┍',
	lineDownDoubleRightDouble: '╔',
	lineDownDoubleRight: '╓',
	lineDownRightDouble: '╒',
	lineUpLeft: '┘',
	lineUpLeftArc: '╯',
	lineUpBoldLeftBold: '┛',
	lineUpBoldLeft: '┚',
	lineUpLeftBold: '┙',
	lineUpDoubleLeftDouble: '╝',
	lineUpDoubleLeft: '╜',
	lineUpLeftDouble: '╛',
	lineUpRight: '└',
	lineUpRightArc: '╰',
	lineUpBoldRightBold: '┗',
	lineUpBoldRight: '┖',
	lineUpRightBold: '┕',
	lineUpDoubleRightDouble: '╚',
	lineUpDoubleRight: '╙',
	lineUpRightDouble: '╘',
	lineUpDownLeft: '┤',
	lineUpBoldDownBoldLeftBold: '┫',
	lineUpBoldDownBoldLeft: '┨',
	lineUpDownLeftBold: '┥',
	lineUpBoldDownLeftBold: '┩',
	lineUpDownBoldLeftBold: '┪',
	lineUpDownBoldLeft: '┧',
	lineUpBoldDownLeft: '┦',
	lineUpDoubleDownDoubleLeftDouble: '╣',
	lineUpDoubleDownDoubleLeft: '╢',
	lineUpDownLeftDouble: '╡',
	lineUpDownRight: '├',
	lineUpBoldDownBoldRightBold: '┣',
	lineUpBoldDownBoldRight: '┠',
	lineUpDownRightBold: '┝',
	lineUpBoldDownRightBold: '┡',
	lineUpDownBoldRightBold: '┢',
	lineUpDownBoldRight: '┟',
	lineUpBoldDownRight: '┞',
	lineUpDoubleDownDoubleRightDouble: '╠',
	lineUpDoubleDownDoubleRight: '╟',
	lineUpDownRightDouble: '╞',
	lineDownLeftRight: '┬',
	lineDownBoldLeftBoldRightBold: '┳',
	lineDownLeftBoldRightBold: '┯',
	lineDownBoldLeftRight: '┰',
	lineDownBoldLeftBoldRight: '┱',
	lineDownBoldLeftRightBold: '┲',
	lineDownLeftRightBold: '┮',
	lineDownLeftBoldRight: '┭',
	lineDownDoubleLeftDoubleRightDouble: '╦',
	lineDownDoubleLeftRight: '╥',
	lineDownLeftDoubleRightDouble: '╤',
	lineUpLeftRight: '┴',
	lineUpBoldLeftBoldRightBold: '┻',
	lineUpLeftBoldRightBold: '┷',
	lineUpBoldLeftRight: '┸',
	lineUpBoldLeftBoldRight: '┹',
	lineUpBoldLeftRightBold: '┺',
	lineUpLeftRightBold: '┶',
	lineUpLeftBoldRight: '┵',
	lineUpDoubleLeftDoubleRightDouble: '╩',
	lineUpDoubleLeftRight: '╨',
	lineUpLeftDoubleRightDouble: '╧',
	lineUpDownLeftRight: '┼',
	lineUpBoldDownBoldLeftBoldRightBold: '╋',
	lineUpDownBoldLeftBoldRightBold: '╈',
	lineUpBoldDownLeftBoldRightBold: '╇',
	lineUpBoldDownBoldLeftRightBold: '╊',
	lineUpBoldDownBoldLeftBoldRight: '╉',
	lineUpBoldDownLeftRight: '╀',
	lineUpDownBoldLeftRight: '╁',
	lineUpDownLeftBoldRight: '┽',
	lineUpDownLeftRightBold: '┾',
	lineUpBoldDownBoldLeftRight: '╂',
	lineUpDownLeftBoldRightBold: '┿',
	lineUpBoldDownLeftBoldRight: '╃',
	lineUpBoldDownLeftRightBold: '╄',
	lineUpDownBoldLeftBoldRight: '╅',
	lineUpDownBoldLeftRightBold: '╆',
	lineUpDoubleDownDoubleLeftDoubleRightDouble: '╬',
	lineUpDoubleDownDoubleLeftRight: '╫',
	lineUpDownLeftDoubleRightDouble: '╪',
	lineCross: '╳',
	lineBackslash: '╲',
	lineSlash: '╱',
};

const specialMainSymbols = {
	tick: '✔',
	info: 'ℹ',
	warning: '⚠',
	cross: '✘',
	squareSmall: '◻',
	squareSmallFilled: '◼',
	circle: '◯',
	circleFilled: '◉',
	circleDotted: '◌',
	circleDouble: '◎',
	circleCircle: 'ⓞ',
	circleCross: 'ⓧ',
	circlePipe: 'Ⓘ',
	radioOn: '◉',
	radioOff: '◯',
	checkboxOn: '☒',
	checkboxOff: '☐',
	checkboxCircleOn: 'ⓧ',
	checkboxCircleOff: 'Ⓘ',
	pointer: '❯',
	triangleUpOutline: '△',
	triangleLeft: '◀',
	triangleRight: '▶',
	lozenge: '◆',
	lozengeOutline: '◇',
	hamburger: '☰',
	smiley: '㋡',
	mustache: '෴',
	star: '★',
	play: '▶',
	nodejs: '⬢',
	oneSeventh: '⅐',
	oneNinth: '⅑',
	oneTenth: '⅒',
};

const specialFallbackSymbols = {
	tick: '√',
	info: 'i',
	warning: '‼',
	cross: '×',
	squareSmall: '□',
	squareSmallFilled: '■',
	circle: '( )',
	circleFilled: '(*)',
	circleDotted: '( )',
	circleDouble: '( )',
	circleCircle: '(○)',
	circleCross: '(×)',
	circlePipe: '(│)',
	radioOn: '(*)',
	radioOff: '( )',
	checkboxOn: '[×]',
	checkboxOff: '[ ]',
	checkboxCircleOn: '(×)',
	checkboxCircleOff: '( )',
	pointer: '>',
	triangleUpOutline: '∆',
	triangleLeft: '◄',
	triangleRight: '►',
	lozenge: '♦',
	lozengeOutline: '◊',
	hamburger: '≡',
	smiley: '☺',
	mustache: '┌─┐',
	star: '✶',
	play: '►',
	nodejs: '♦',
	oneSeventh: '1/7',
	oneNinth: '1/9',
	oneTenth: '1/10',
};

const mainSymbols = {...common, ...specialMainSymbols};
const fallbackSymbols = {...common, ...specialFallbackSymbols};

const shouldUseMain = isUnicodeSupported();
const figures = shouldUseMain ? mainSymbols : fallbackSymbols;

function ansiRegex({onlyFirst = false} = {}) {
	const pattern = [
	    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
		'(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
	].join('|');

	return new RegExp(pattern, onlyFirst ? undefined : 'g');
}

const regex = ansiRegex();

function stripAnsi(string) {
	if (typeof string !== 'string') {
		throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
	}

	// Even though the regex is global, we don't need to reset the `.lastIndex`
	// because unlike `.exec()` and `.test()`, `.replace()` does it automatically
	// and doing it manually has a performance penalty.
	return string.replace(regex, '');
}

// src/signale.ts
var logTypes = {
  error: {
    badge: figures.cross,
    color: "red",
    label: "error",
    logLevel: "error"
  },
  fatal: {
    badge: figures.cross,
    color: "red",
    label: "fatal",
    logLevel: "error"
  },
  alert: {
    badge: "\u2B24",
    color: "red",
    label: "alert",
    logLevel: "error"
  },
  fav: {
    badge: "\u2764",
    color: "magenta",
    label: "favorite",
    logLevel: "info"
  },
  info: {
    badge: figures.info,
    color: "blue",
    label: "info",
    logLevel: "info"
  },
  star: {
    badge: figures.star,
    color: "yellow",
    label: "star",
    logLevel: "info"
  },
  success: {
    badge: figures.tick,
    color: "green",
    label: "success",
    logLevel: "info"
  },
  wait: {
    badge: figures.ellipsis,
    color: "blue",
    label: "waiting",
    logLevel: "info"
  },
  warn: {
    badge: figures.warning,
    color: "yellow",
    label: "warning",
    logLevel: "warn"
  },
  complete: {
    badge: figures.checkboxOn,
    color: "cyan",
    label: "complete",
    logLevel: "info"
  },
  pending: {
    badge: figures.checkboxOff,
    color: "magenta",
    label: "pending",
    logLevel: "info"
  },
  note: {
    badge: figures.bullet,
    color: "blue",
    label: "note",
    logLevel: "info"
  },
  start: {
    badge: figures.play,
    color: "green",
    label: "start",
    logLevel: "info"
  },
  pause: {
    badge: figures.squareSmallFilled,
    color: "yellow",
    label: "pause",
    logLevel: "info"
  },
  debug: {
    badge: figures.pointerSmall,
    color: "gray",
    label: "debug",
    logLevel: "debug"
  },
  await: {
    badge: figures.ellipsis,
    color: "blue",
    label: "awaiting",
    logLevel: "info"
  },
  watch: {
    badge: figures.ellipsis,
    color: "yellow",
    label: "watching",
    logLevel: "info"
  },
  log: {
    badge: "",
    color: "",
    label: "",
    logLevel: "info"
  }
};
var logger_types_default = logTypes;

// src/options.ts
var defaultOptions = {
  "displayScope": true,
  "displayBadge": true,
  "displayDate": false,
  "displayFilename": false,
  "displayLabel": true,
  "displayTimestamp": false,
  "underlineLabel": true,
  "underlineMessage": false,
  "underlinePrefix": false,
  "underlineSuffix": false,
  "uppercaseLabel": false
};

// src/signale.ts
var defaultLogLevels = {
  debug: 0,
  info: 1,
  timer: 2,
  warn: 3,
  error: 4
};
var { green, grey, red, underline, yellow } = chalk;
var isPreviousLogInteractive = false;
function defaultScopeFormatter(scopes) {
  return `[${scopes.join("::")}]`;
}
function barsScopeFormatter(scopes) {
  return scopes.map((scope) => `[${scope}]`).join(" ");
}
var _SignaleImpl = class _SignaleImpl {
  constructor(options = {}) {
    this._interactive = options.interactive || false;
    this._config = Object.assign({}, options.config);
    this._customTypes = Object.assign({}, options.types);
    this._customLogLevels = Object.assign({}, options.logLevels);
    this._logLevels = Object.assign(
      {},
      defaultLogLevels,
      this._customLogLevels
    );
    this._disabled = options.disabled || false;
    this._scopeName = options.scope || "";
    this._scopeFormatter = options.scopeFormatter || defaultScopeFormatter;
    this._timers = /* @__PURE__ */ new Map();
    this._seqTimers = [];
    this._types = this._mergeTypes(logger_types_default, this._customTypes);
    this._stream = options.stream || process.stderr;
    this._longestLabel = this._getLongestLabel();
    this._secrets = options.secrets || [];
    this._generalLogLevel = this._validateLogLevel(options.logLevel);
    Object.keys(this._types).forEach((type) => {
      this[type] = this._logger.bind(this, type);
    });
  }
  get _now() {
    return Date.now();
  }
  get scopePath() {
    return this._arrayify(this._scopeName).filter((x) => x.length !== 0);
  }
  get currentOptions() {
    return {
      config: this._config,
      disabled: this._disabled,
      types: this._customTypes,
      interactive: this._interactive,
      stream: this._stream,
      scopeFormatter: this._scopeFormatter,
      secrets: this._secrets,
      logLevels: this._customLogLevels,
      logLevel: this._generalLogLevel
    };
  }
  get date() {
    const _ = /* @__PURE__ */ new Date();
    return [_.getFullYear(), _.getMonth() + 1, _.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  }
  get timestamp() {
    const _ = /* @__PURE__ */ new Date();
    return [_.getHours(), _.getMinutes(), _.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  }
  get filename() {
    const _ = Error.prepareStackTrace;
    Error.prepareStackTrace = (_error, stack2) => stack2;
    const stack = new Error().stack;
    Error.prepareStackTrace = _;
    const callers = stack.map((x) => x.getFileName());
    const firstExternalFilePath = callers.find((x) => {
      return x !== callers[0];
    });
    return firstExternalFilePath ? path.basename(firstExternalFilePath) : "anonymous";
  }
  get _longestUnderlinedLabel() {
    return underline(this._longestLabel);
  }
  set configuration(configObj) {
    this._config = Object.assign({}, defaultOptions, configObj);
  }
  _arrayify(x) {
    return Array.isArray(x) ? x : [x];
  }
  _timeSpan(then) {
    return this._now - then;
  }
  _getLongestLabel() {
    const { _types } = this;
    const labels = Object.keys(_types).map((x) => _types[x].label || "");
    return labels.reduce((x, y) => x.length > y.length ? x : y);
  }
  _validateLogLevel(level) {
    return level && Object.keys(this._logLevels).includes(level) ? level : "debug";
  }
  _mergeTypes(standard, custom) {
    const types = Object.assign({}, standard);
    Object.keys(custom).forEach((type) => {
      types[type] = Object.assign({}, types[type], custom[type]);
    });
    return types;
  }
  _filterSecrets(message) {
    const { _secrets } = this;
    if (_secrets.length === 0) {
      return message;
    }
    let safeMessage = message;
    _secrets.forEach((secret) => {
      safeMessage = safeMessage.replace(
        new RegExp(String(secret), "g"),
        "[secure]"
      );
    });
    return safeMessage;
  }
  _formatStream(stream) {
    return this._arrayify(stream);
  }
  _formatDate() {
    return `[${this.date}]`;
  }
  _formatFilename() {
    return `[${this.filename}]`;
  }
  _formatScopeName() {
    return this._scopeFormatter(this.scopePath);
  }
  _formatTimestamp() {
    return `[${this.timestamp}]`;
  }
  _formatMessage(str) {
    return util.format(...this._arrayify(str));
  }
  _meta() {
    const meta = [];
    if (this._config.displayDate) {
      meta.push(this._formatDate());
    }
    if (this._config.displayTimestamp) {
      meta.push(this._formatTimestamp());
    }
    if (this._config.displayFilename) {
      meta.push(this._formatFilename());
    }
    if (this.scopePath.length !== 0 && this._config.displayScope) {
      meta.push(this._formatScopeName());
    }
    if (meta.length !== 0) {
      meta.push(`${figures.pointerSmall}`);
      return meta.map((item) => grey(item));
    }
    return meta;
  }
  _hasAdditional({ suffix, prefix }, args) {
    return suffix || prefix ? "" : this._formatMessage(args);
  }
  _buildSignale(type, ...args) {
    let msg;
    let additional = {};
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      if (args[0] instanceof Error) {
        [msg] = args;
      } else {
        const [{ prefix, message, suffix }] = args;
        additional = Object.assign({}, { suffix, prefix });
        msg = message ? this._formatMessage(message) : this._hasAdditional(additional, args);
      }
    } else {
      msg = this._formatMessage(args);
    }
    const signale2 = this._meta();
    if (additional.prefix) {
      if (this._config.underlinePrefix) {
        signale2.push(underline(additional.prefix));
      } else {
        signale2.push(additional.prefix);
      }
    }
    const colorize = type.color ? chalk[type.color] : chalk.white;
    if (this._config.displayBadge && type.badge) {
      signale2.push(colorize(this._padEnd(type.badge, type.badge.length + 1)));
    }
    if (this._config.displayLabel && type.label) {
      const label = this._config.uppercaseLabel ? type.label.toUpperCase() : type.label;
      if (this._config.underlineLabel) {
        signale2.push(
          colorize(
            this._padEnd(
              underline(label),
              this._longestUnderlinedLabel.length + 1
            )
          )
        );
      } else {
        signale2.push(
          colorize(this._padEnd(label, this._longestLabel.length + 1))
        );
      }
    }
    if (msg instanceof Error && msg.stack) {
      const [name, ...rest] = msg.stack.split("\n");
      if (this._config.underlineMessage) {
        signale2.push(underline(name));
      } else {
        signale2.push(name);
      }
      signale2.push(grey(rest.map((l) => l.replace(/^/, "\n")).join("")));
      return signale2.join(" ");
    }
    if (this._config.underlineMessage) {
      signale2.push(underline(msg));
    } else {
      signale2.push(msg);
    }
    if (additional.suffix) {
      if (this._config.underlineSuffix) {
        signale2.push(underline(additional.suffix));
      } else {
        signale2.push(additional.suffix);
      }
    }
    return signale2.join(" ");
  }
  _write(stream$1, message) {
    const isTTY = stream$1.isTTY || false;
    if (this._interactive && isTTY && isPreviousLogInteractive) {
      readline.moveCursor(stream$1, 0, -1);
      readline.clearLine(stream$1, 0);
      readline.cursorTo(stream$1, 0);
    }
    if (stream$1 instanceof stream.Writable) {
      if (!isTTY) {
        stream$1.write(`${stripAnsi(message)}
`);
      } else {
        stream$1.write(`${message}
`);
      }
    } else {
      if (!isTTY) {
        stream$1.write(`${stripAnsi(message)}
`);
      } else {
        stream$1.write(`${message}
`);
      }
    }
    isPreviousLogInteractive = this._interactive;
  }
  _log(message, streams = this._stream, logLevel) {
    if (this.isEnabled() && this._logLevels[logLevel] >= this._logLevels[this._generalLogLevel]) {
      this._formatStream(streams).forEach((stream) => {
        this._write(stream, message);
      });
    }
  }
  _logger(type, ...messageObj) {
    const { stream, logLevel } = this._types[type];
    const message = this._buildSignale(this._types[type], ...messageObj);
    this._log(
      this._filterSecrets(message),
      stream,
      this._validateLogLevel(logLevel)
    );
  }
  _padEnd(str, targetLength) {
    str = String(str);
    if (str.length >= targetLength) {
      return str;
    }
    return str.padEnd(targetLength);
  }
  addSecrets(secrets) {
    if (!Array.isArray(secrets)) {
      throw new TypeError("Argument must be an array.");
    }
    this._secrets.push(...secrets);
  }
  clearSecrets() {
    this._secrets = [];
  }
  config(configObj) {
    this.configuration = configObj;
  }
  disable() {
    this._disabled = true;
  }
  enable() {
    this._disabled = false;
  }
  isEnabled() {
    return !this._disabled;
  }
  clone(options) {
    const SignaleConstructor = _SignaleImpl;
    const newInstance = new SignaleConstructor(
      Object.assign({}, this.currentOptions, options)
    );
    newInstance._timers = new Map(this._timers.entries());
    newInstance._seqTimers = [...this._seqTimers];
    return newInstance;
  }
  scope(...name) {
    if (name.length === 0) {
      throw new Error("No scope name was defined.");
    }
    return this.clone({
      scope: name
    });
  }
  child(name) {
    const newScope = this.scopePath.concat(name);
    return this.scope(...newScope);
  }
  unscope() {
    this._scopeName = "";
  }
  time(label) {
    if (!label) {
      label = `timer_${this._timers.size}`;
      this._seqTimers.push(label);
    }
    this._timers.set(label, this._now);
    const message = this._meta();
    message.push(green(this._padEnd(this._types.start.badge, 2)));
    if (this._config.underlineLabel) {
      message.push(
        green(
          this._padEnd(
            underline(label),
            this._longestUnderlinedLabel.length + 1
          )
        )
      );
    } else {
      message.push(green(this._padEnd(label, this._longestLabel.length + 1)));
    }
    message.push("Initialized timer...");
    this._log(message.join(" "), this._stream, "timer");
    return label;
  }
  timeEnd(label) {
    if (!label && this._seqTimers.length) {
      label = this._seqTimers.pop();
    }
    if (label && this._timers.has(label)) {
      const span = this._timeSpan(this._timers.get(label));
      this._timers.delete(label);
      const message = this._meta();
      message.push(red(this._padEnd(this._types.pause.badge, 2)));
      if (this._config.underlineLabel) {
        message.push(
          red(
            this._padEnd(
              underline(label),
              this._longestUnderlinedLabel.length + 1
            )
          )
        );
      } else {
        message.push(red(this._padEnd(label, this._longestLabel.length + 1)));
      }
      message.push("Timer run for:");
      message.push(
        yellow(span < 1e3 ? span + "ms" : (span / 1e3).toFixed(2) + "s")
      );
      this._log(message.join(" "), this._stream, "timer");
      return { label, span };
    }
  }
};
_SignaleImpl.barsScopeFormatter = barsScopeFormatter;
var SignaleImpl = _SignaleImpl;
var signale_default = SignaleImpl;

// src/main.ts
var signale = Object.assign(new signale_default(), {
  Signale: signale_default
});
var main_default = signale;

const __dirname$1 = url.fileURLToPath(new URL('.', (typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.src || new URL('index.cjs', document.baseURI).href))));
const NODE_ENV = process.env.NODE_ENV || 'production';

let IS_NPM_PACKAGE = false;
try {
    const require$1 = node_module.createRequire((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.src || new URL('index.cjs', document.baseURI).href)));
    IS_NPM_PACKAGE = !!require$1.resolve('crittr');
} catch (e) {}

const pathToCrittr = NODE_ENV === 'development' && !IS_NPM_PACKAGE ? 'lib' : 'lib'; // Only keep for later browser support?

/**
 *
 * @param options
 * @returns {Promise<[<string>, <string>]>}
 */
var index = async options => {
    main_default.time('Crittr Run');
    const { Crittr } = await import(path.join(__dirname$1, pathToCrittr, 'classes', 'Crittr.class.js'));

    let crittr;
    let resultObj = { critical: null, rest: null };

    crittr = new Crittr(options);

    resultObj = await crittr.run();

    main_default.timeEnd('Crittr Run');
    return resultObj;
};

module.exports = index;
