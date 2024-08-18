import { createRequire as createRequire$1 } from 'node:module';
import log from '@dynamicabot/signales';
import path from 'path';
import url from 'url';
import fs from 'fs-extra';
import util from 'util';
import doDebug from 'debug';
import chalk from 'chalk';
import merge from 'deepmerge';
import { isPlainObject } from 'is-plain-object';
import Queue from 'run-queue';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import CleanCSS from 'clean-css';
import postcss from 'postcss';
import sortMediaQueries from 'postcss-sort-media-queries';
import pruneVar from 'postcss-prune-var';
import { createRequire } from 'module';
import _ from 'lodash';
import hash from 'object-hash';
import css from 'css';

var removeDuplicateVariables = () => {
  return (root) => {
      root.walkRules(rule => {
          const seenVars = new Map();

          rule.walkDecls(decl => {
              if (decl.prop.startsWith('--')) {
                  // If the variable has been seen, remove the previous one
                  if (seenVars.has(decl.prop)) {
                      seenVars.get(decl.prop).remove();
                  }
                  // Store the current declaration
                  seenVars.set(decl.prop, decl);
              }
          });
      });
  };
};

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const package_json = require(path.join('..', 'package.json'));

var DEFAULTS = {
    // DEFAULTS
    PROJECT_DIR: path.resolve(__dirname, '..'),

    // CRITTR BASED

    PRINT_BROWSER_CONSOLE: false,
    DROP_KEYFRAMES: true,
    PUPPETEER_HEADLESS: 'new',
    BROWSER_USER_AGENT: 'Crittr ' + package_json.version,
    BROWSER_CACHE_ENABLED: true,
    BROWSER_JS_ENABLED: true,
    BROWSER_CONCURRENT_TABS: 10,
    DEVICE_WIDTH: 1200,
    DEVICE_HEIGHT: 1080,
    DEVICE_SCALE_FACTOR: 1,
    DEVICE_IS_MOBILE: false,
    DEVICE_HAS_TOUCH: false,
    DEVICE_IS_LANDSCAPE: false,
    TIMEOUT: 30000,
    PAGE_LOAD_TIMEOUT: 2000,
    PAGE_RENDER_TIMEOUT: 300,
    PAGE_SCREENSHOT: false,
    OUTPUT_REMAINING_CSS: true,

    // CODE BASED
    RULE_SEPARATOR: '-#-',

    SCREENSHOT_NAME_GENERATOR: null,
};

/**
 * Rule Class with static functions to handle rule comparision and more
 *
 * @static
 */
class Rule {
    /**
     * Checks if rule is a native duplicate. Checks all properties but excluded
     * @static
     *
     * @param rule1
     * @param rule2
     * @param excludedProperties
     *
     * @return {boolean}
     */
    static isRuleDuplicate(rule1, rule2, excludedProperties) {
        excludedProperties = excludedProperties || [];

        const hasSameProperties = _.isEqualWith(rule1, rule2, (value1, value2, propKey) => {
            if (excludedProperties.includes(propKey)) return true;
        });

        return hasSameProperties;
    }

    /**
     *  Compares 2 ast rules by type
     *
     * @static
     * @param {!Object} rule1
     * @param {!Object} rule2
     * @returns {boolean}
     */
    static isSameRuleType(rule1, rule2) {
        return rule1.type === rule2.type;
    }

    /**
     * Returns true if rule is of type "media"
     *
     * @static
     * @param {Object} rule
     * @returns {boolean}
     */
    static isMediaRule(rule) {
        return rule.type === 'media';
    }

    static isSupportsRule(rule) {
        return rule.type === 'supports';
    }

    static isRule(rule) {
        return rule.type === 'rule';
    }

    static isStyleRule(rule) {
        return rule.type === 'rule';
    }

    static isKeyframe(rule) {
        return rule.type === 'keyframe';
    }

    static isKeyframes(rule) {
        return rule.type === 'keyframes';
    }

    static isCharset(rule) {
        return rule.type === 'charset';
    }

    static isComment(rule) {
        return rule.type === 'comment';
    }

    static isFontFace(rule) {
        return rule.type === 'font-face';
    }

    static isGroupRule(rule) {
        return rule[rule.type] !== undefined;
    }

    static isStylesheet(rule) {
        return rule.type === 'stylesheet';
    }

    static isImportantRule(rule) {
        return Rule.isMediaRule(rule) || Rule.isRule(rule);
    }

    /**
     * Returns true if selector_1 is matching selector_2 as a media rule selector.
     * Also checks valid differences between media selectors that mean the same.
     * "all and " is not needed for the same result. Therefor we need to check the rules more gracefully
     *
     * @static
     * @param selector_1
     * @param selector_2
     * @returns {boolean}
     */
    static isMatchingMediaRuleSelector(selector_1, selector_2) {
        return (
            selector_1 === selector_2 ||
            selector_1 === selector_2.replace('all and ', '') ||
            selector_2 === selector_1.replace('all and ', '') ||
            selector_1.replace('all and ', '') === selector_2.replace('all and ', '')
        );
    }

    static generateRuleKey(rule, groupPrefix = '', withKeySeparator = false) {
        const keySeparator = withKeySeparator ? DEFAULTS.RULE_SEPARATOR : '';
        let ruleStr = 'default';

        if (Rule.isRule(rule) && rule.selectors) {
            ruleStr = rule.selectors.join();
        } else if (Rule.isCharset(rule)) {
            ruleStr = rule.charset;
        } else if (Rule.isKeyframes(rule)) {
            ruleStr = rule.name;
        } else if (Rule.isKeyframe(rule)) {
            ruleStr = rule.values.join();
        } else if (Rule.isMediaRule(rule)) {
            ruleStr = `${rule.type} ${rule.media}`;
        } else if (Rule.isSupportsRule(rule)) {
            ruleStr = `${rule.type} ${rule.supports}`;
        } else if (Rule.isFontFace(rule)) {
            ruleStr = rule.type;
        } else if (Rule.isComment(rule)) {
            return false;
        } else if (Rule.isGroupRule(rule)) {
            ruleStr = `${rule.type} ${rule[rule.type]}`;
        } else {
            //log.error("Can not generate rule key of rule without selectors! Setting default key!", rule);
            return ruleStr;
        }

        return groupPrefix + keySeparator + ruleStr;
    }
}

// PRIVATE VARS
const REMOVEABLE_PROPS = ['position'];

// PRIVATE FUNCTIONS
const cleanUnusedProperties = obj => {
    for (let prop in obj) {
        if (REMOVEABLE_PROPS.includes(prop)) {
            delete obj[prop];
        }

        const item = obj[prop];
        if (Array.isArray(item) || typeof item === 'object') {
            cleanUnusedProperties(item);
        }
    }
};

const handleRule = (ruleObj, map) => {
    // Ignore comments
    if (!Rule.isComment(ruleObj)) {
        cleanUnusedProperties(ruleObj); // Remove position. We don't need that any longer

        // Handle MediaQuery
        if (Rule.isMediaRule(ruleObj)) {
            const media = Ast.MEDIA_PREFIX + ruleObj.media;
            const mediaRulesArr = map.get(media);
            const mRules = ruleObj.rules;

            // There are already media rules in our set
            if (mediaRulesArr && mediaRulesArr.length > 0) {
                // Filter the rules of the proccessed media query for already existing and only return
                // rules that does not exist in the mq map
                const newRules = mRules
                    .filter(mRule => {
                        const objHash = hash.MD5(mRule);
                        return !mediaRulesArr.some(ruleObj => ruleObj.hash === objHash);
                    })
                    .map(mRule => {
                        const objHash = hash.MD5(mRule);
                        return {
                            hash: objHash,
                            rule: mRule,
                        };
                    });
                map.set(media, [...mediaRulesArr, ...newRules]);
            } else {
                // Fresh media rules can be created
                map.set(
                    media,
                    mRules.map(mRule => {
                        const objHash = hash.MD5(mRule);
                        return {
                            hash: objHash,
                            rule: mRule,
                        };
                    }),
                );
            }
        } else {
            const ruleKey = Rule.generateRuleKey(ruleObj);
            const rulesArray = map.get(ruleKey);
            const objHash = hash.MD5(ruleObj);

            if (rulesArray) {
                // If this rule object (hash) already exists in this ruleKey ignore else insert
                if (!rulesArray.some(ruleObj => ruleObj.hash === objHash)) {
                    rulesArray.push({
                        hash: objHash,
                        rule: ruleObj,
                    });
                }
            } else {
                map.set(ruleKey, [
                    {
                        hash: objHash,
                        rule: ruleObj,
                    },
                ]);
            }
        }
    }
};

/**
 * Rule Class with static functions to handle ast management
 *
 * @static
 */
class Ast {
    static generateRuleMap(ast, ruleMap = new Map()) {
        if (ast.type && ast.type === 'stylesheet' && ast.stylesheet && Array.isArray(ast.stylesheet.rules)) {
            const restRules = ast.stylesheet.rules;

            for (const ruleObj of restRules) {
                handleRule(ruleObj, ruleMap);
            }
        }

        return ruleMap;
    }

    static getAstOfRuleMap(ruleMap) {
        const ast = {
            type: 'stylesheet',
            stylesheet: {
                rules: [],
            },
        };
        const astRules = ast.stylesheet.rules;

        for (let [ruleKey, rulesObj] of ruleMap) {
            // Empty declarations break reworkcss/css. https://github.com/reworkcss/css/issues/92
            if (rulesObj[0].rule.hasOwnProperty('declarations') && !rulesObj[0].rule.declarations.length) {
                break;
            }

            if (rulesObj[0].rule.type === 'rule' && !rulesObj[0].rule.hasOwnProperty('declarations')) {
                break;
            }

            // Is this rule a media query?
            if (ruleKey.includes(Ast.MEDIA_PREFIX)) {
                const mqStr = ruleKey.replace(Ast.MEDIA_PREFIX, '');
                astRules.push({
                    type: 'media',
                    media: mqStr,
                    rules: rulesObj.map(ruleObj => {
                        return ruleObj.rule;
                    }),
                });
            } else {
                astRules.push(...rulesObj.map(ruleObj => ruleObj.rule));
            }
        }

        return ast;
    }

    static isMediaObj(ruleKey) {
        return ruleKey.includes(Ast.MEDIA_PREFIX);
    }
}

Ast.TYPES_TO_REMOVE = ['comment'];

Ast.MEDIA_PREFIX = '@media ';

const debug$1 = doDebug('crittr:css-transformator');

/**
 *
 */
class CssTransformator {
    constructor(options) {
        options = options || {};
        this.options = {
            silent: true,
            source: null,
        };

        this.options = merge(this.options, options);

        this.CRITICAL_TYPES_TO_KEEP = ['media', 'rule', 'charset', 'font-face', 'supports'];

        this.GROUP_SEPERATOR = '-##-';
    }

    getAst(cssContent) {
        let astObj = null;
        try {
            debug$1('getAst - Try parsing css to ast ...');
            astObj = css.parse(cssContent, {
                silent: this.options.silent,
                source: this.options.source,
            });
            debug$1('getAst - Css successfully parsed to ast ...');
        } catch (err) {
            log.error(err);
        }
        return astObj;
    }

    getCssFromAst(ast) {
        return css.stringify(ast, {
            indent: '  ',
            compress: false,
            sourcemap: true,
            inputSourcemaps: true,
        }).code;
    }

    getCriticalRuleSelectors(rule, selectorMap, groupPrefix = '') {
        const ruleKey = Rule.generateRuleKey(rule, groupPrefix);

        if (selectorMap.has(ruleKey)) {
            const critObj = selectorMap.get(ruleKey);
            return rule.selectors.filter(selector => critObj.selectors.includes(selector));
        }

        return [];
    }

    isGroupType(rule) {
        // AST RULES have a interface GroupingRule
        // developer.mozilla.org/en-US/docs/Web/API/CSSGroupingRule
        return rule.type !== 'rule' && rule.rules !== undefined;
    }

    getRuleType(rule) {
        return rule.type || '';
    }

    getGroupRuleId(rule) {
        const type = this.getRuleType(rule);
        const typeString = rule[type] || '';

        return `${type}${typeString}`;
    }

    processRuleCollection({ rules, selectorMap, criticalSelectorsMap, isCritical = false, groupPrefix = '' }) {
        const processedRules = [];

        for (let rule of rules) {
            let newRule = null;

            if (this.isGroupType(rule)) {
                // Grouped rule handling
                const prefix = (groupPrefix ? `${groupPrefix}${this.GROUP_SEPERATOR}` : '') + this.getGroupRuleId(rule);

                rule.rules = this.processRuleCollection({
                    rules: rule.rules,
                    selectorMap,
                    criticalSelectorsMap,
                    isCritical,
                    groupPrefix: prefix,
                });

                // If media query is empty remove
                if (rule.rules.length === 0) {
                    newRule = null;
                } else {
                    newRule = rule;
                }
            } else {
                // Single rule -> can be processed
                if (isCritical) {
                    newRule = this.processCriticalRule(rule, selectorMap, criticalSelectorsMap, groupPrefix);
                } else {
                    newRule = this.processNonCriticalRule(rule, criticalSelectorsMap, groupPrefix);
                }
            }

            // Fill new Array if no empty rule
            if (newRule !== null) {
                processedRules.push(newRule);
            }
        }

        // Remove empty rules

        return processedRules;
    }

    processCriticalRule(rule, selectorMap, criticalSelectorsMap, groupPrefix) {
        // Get rule key
        const ruleKey = Rule.generateRuleKey(rule, groupPrefix);
        // Get the critical selectors of this media internal rule
        rule.selectors = this.getCriticalRuleSelectors(rule, selectorMap, groupPrefix);
        // Create Map entry for exclude of remaining ast
        criticalSelectorsMap.set(ruleKey, rule.selectors);

        // If there are no critical selectors mark this rule as removed and set it to null
        if (rule.type === 'rule' && rule.selectors.length === 0) {
            return null;
        }

        return rule;
    }

    processNonCriticalRule(rule, criticalSelectorsMap, groupPrefix) {
        // Get rule key
        const ruleKey = Rule.generateRuleKey(rule, groupPrefix);

        if (criticalSelectorsMap.has(ruleKey)) {
            const criticalSelectorsOfRule = criticalSelectorsMap.get(ruleKey);
            const selectors = rule.selectors || [];
            const newSelectors = [];
            for (const selector of selectors) {
                if (!criticalSelectorsOfRule.includes(selector)) {
                    newSelectors.push(selector);
                }
            }

            rule.selectors = newSelectors;
        }

        if (rule.type === 'rule' && rule.selectors.length === 0) {
            rule = null;
        }

        return rule;
    }

    /**
     * Filters the AST Object with the selectorMap <Map> containing selectors.
     * Returns a new AST Object without those selectors. Does NOT mutate the AST.
     *
     * @param   {Object} ast
     * @param   {Map}    selectorMap
     * @returns {Object} AST
     */
    filterByMap(ast, selectorMap) {
        let _ast = JSON.parse(JSON.stringify(ast));
        let _astRest = JSON.parse(JSON.stringify(ast));
        const _astRoot = _ast.stylesheet;
        const _astRestRoot = _astRest.stylesheet;
        const criticalSelectorsMap = new Map();

        // Filter rule types we don't want in critical
        let newRules = _astRoot.rules.filter(rule => {
            return this.CRITICAL_TYPES_TO_KEEP.includes(rule.type);
        });

        // HANDLE CRITICAL CSS
        newRules = this.processRuleCollection({
            rules: newRules,
            selectorMap: selectorMap,
            criticalSelectorsMap: criticalSelectorsMap,
            isCritical: true,
        });

        // HANDLE REST CSS
        const astRestRules = _astRestRoot.rules;
        let restRules = this.processRuleCollection({
            rules: astRestRules,
            criticalSelectorsMap: criticalSelectorsMap,
            isCritical: false,
        });

        _astRoot.rules = newRules;
        _astRestRoot.rules = restRules;

        // Return the new AST Object
        return [_ast, _astRest];
    }
}

/**
 * Used to extract critical css with the help of a source css. This will result in larger size because every vendor
 * prefix is used.
 *
 * @param sourceAst
 * @param renderTimeout
 * @param keepSelectors
 * @returns {Promise<Map<Object>>}
 */
var extractCriticalCss_script = async ({ sourceAst, loadTimeout, keepSelectors, removeSelectors }) => {
    return new Promise((resolve, reject) => {
        // PRE CONFIG VARS
        const usedSelectorTypes = ['supports', 'media', 'rule'];

        const pseudoSelectors = ['after', 'before', 'first-line', 'first-letter', 'selection', 'visited'];

        const pseudoExcludes = ['root'];

        const PSEUDO_DEFAULT_REGEX = new RegExp(
            pseudoSelectors.map(s => ':?:' + s).reduce((acc, cur) => acc + '|' + cur),
            'g',
        );
        const PSEUDO_EXCLUDED_REGEX = new RegExp(
            pseudoExcludes.map(s => ':?:' + s).reduce((acc, cur) => acc + '|' + cur),
            'g',
        );
        const PSEUDO_BROWSER_REGEX = new RegExp(/:?:-[a-z-]*/g);

        // ADJUSTMENTS
        keepSelectors = keepSelectors || [];
        removeSelectors = removeSelectors || [];
        loadTimeout = loadTimeout || 2000;

        // innerHeight of window to determine if in viewport
        const height = window.innerHeight;

        // Nodes in above the fold content
        const criticalNodes = new Set();
        // Final result Map
        const criticalSelectors = new Map();

        const stopPageLoadAfterTimeout = (start, timeout) => {
            window.requestAnimationFrame(() => {
                const timePassed = Date.now() - start;
                if (timePassed >= timeout) {
                    window.stop();
                } else {
                    stopPageLoadAfterTimeout(start, timeout);
                }
            });
        };
        stopPageLoadAfterTimeout(Date.now(), loadTimeout);

        const isSelectorCritical = selector => {
            if (isSelectorForceIncluded(selector)) return true;
            if (isSelectorForceExcluded(selector)) return false;

            // clean selector from important pseudo classes to get him tracked as critical
            const cleanedSelector = getCleanedSelector(selector);

            let elements;
            try {
                elements = document.querySelectorAll(cleanedSelector);
            } catch (e) {
                // Selector not valid
                return false;
            }

            // selector has > 0 elements matching -> check for above the fold - break on success
            const elemLength = elements.length;
            for (let i = 0; i < elemLength; i++) {
                if (isElementAboveTheFold(elements[i])) {
                    return true;
                }
            }
            return false;
        };

        const isStyleSheet = rule => {
            return rule.stylesheet !== undefined;
        };

        /**
         * Clean selector of pseudo classes
         *
         * @param selector
         * @returns selector {String}
         */
        const getCleanedSelector = selector => {
            // We wont clean selectors without ":" because its faster as to replace all
            if (selector.indexOf(':' > -1)) {
                selector = selector.replace(PSEUDO_DEFAULT_REGEX, '');
            }
            // Remove browser pseudo selectors
            if (selector.indexOf(':' > -1)) {
                selector = selector.replace(PSEUDO_BROWSER_REGEX, '');
            }
            // Remove excluded pseudo selectors
            if (selector.indexOf(':' > -1)) {
                selector = selector.replace(PSEUDO_EXCLUDED_REGEX, '');
            }

            return selector;
        };

        /**
         * If selector is purely pseudo (f.e. ::-moz-placeholder) -> KEEP IT.
         * But don't keep excludedPseudos by default
         *
         * @param selector
         * @returns {boolean}
         */
        const isPurePseudo = selector => selector.startsWith(':') && selector.match(PSEUDO_EXCLUDED_REGEX) === null;

        /**
         * Creates a regex out of a wildcard selector. Returns the normal regex for a non wildcard selector
         *
         * @param {string} selector
         * @returns {RegExp} {RegExp}
         */
        const getRegexOfSelector = selector => {
            selector = '^' + selector.replace(/([.*><+~])/g, '\\$1').replace(/%/g, '.*') + '$';
            return new RegExp(selector, 'gm');
        };

        const isSelectorForceIncluded = selector => {
            return (
                keepSelectors.includes(selector) ||
                keepSelectors.some(tmpSel => {
                    const selectorWcRegex = getRegexOfSelector(tmpSel); // transform wildcards into regex
                    return selectorWcRegex.test(selector);
                })
            );
        };

        const isSelectorForceExcluded = selector => {
            return (
                removeSelectors.includes(selector) ||
                removeSelectors.some(tmpSel => {
                    const selectorWcRegex = getRegexOfSelector(tmpSel); // transform wildcards into regex
                    return selectorWcRegex.test(selector);
                })
            );
        };

        const isElementAboveTheFold = element => {
            if (criticalNodes.has(element)) return true;

            const isAboveTheFold = element.getBoundingClientRect().top < height;

            if (isAboveTheFold) {
                criticalNodes.add(element);
                return true;
            }

            return false;
        };

        const isGroupRule = rule => {
            return rule.type !== 'rule' && rule.rules !== undefined;
        };

        const getRuleType = rule => {
            return rule.type;
        };

        const getGroupRuleId = rule => {
            const type = getRuleType(rule) || '';
            const typeString = rule[type] || '';

            return `${type}${typeString}`;
        };

        /**
         * Working criticalSelectors Map
         * @param ast
         */
        const fillCriticalSelectorsMap = (rule, groupIdPrefix = '') => {
            if (isGroupRule(rule)) {
                if (groupIdPrefix) {
                    groupIdPrefix = `${groupIdPrefix}-##-`;
                }
                // Get rule prefix for grouped rule
                const rulePrefix = `${groupIdPrefix}${getGroupRuleId(rule)}`;
                // Grouped rules always having rules
                const rules = rule.rules;

                // Iterate rules
                for (let rule of rules) {
                    // Get ruletype
                    const ruleType = getRuleType(rule);

                    // Is rule part of useful rule types
                    if (usedSelectorTypes.includes(ruleType)) {
                        // Call recursive
                        fillCriticalSelectorsMap(rule, rulePrefix);
                    } else {
                        console.debug('DEBUG: UNPROCESSED RULE TYPE: ' + rule.type);
                    }
                }
            } else {
                // Handle a single rule

                // Get ruletype
                const ruleType = getRuleType(rule);

                // Is rule part of useful rule types
                if (usedSelectorTypes.includes(ruleType)) {
                    // Normal rules have selectors
                    const selectors = rule.selectors || [];

                    // Key for identify
                    const ruleKey = groupIdPrefix + selectors.join();

                    for (let selector of selectors) {
                        // Check if selector is pure pseudo or a critical match
                        // NOTE: Check if we are in trouble with doubled selectors with different content

                        if (isPurePseudo(selector) || isSelectorCritical(selector)) {
                            if (criticalSelectors.has(ruleKey)) {
                                const critSel = criticalSelectors.get(ruleKey);
                                if (!critSel.selectors.includes(selector)) {
                                    critSel.selectors.push(selector);
                                }
                            } else {
                                criticalSelectors.set(ruleKey, {
                                    selectors: [selector],
                                    type: rule.type,
                                    rule: rule, // Needed? maybe for doubled rules
                                });
                            }
                        }
                    }
                } else {
                    console.debug('DEBUG: UNPROCESSED RULE TYPE: ' + rule.type);
                }
            }
        };

        console.log('STARTING EXTRACTION');

        // Root knot handling
        if (isStyleSheet(sourceAst)) {
            _astRoot = sourceAst.stylesheet;
            fillCriticalSelectorsMap(_astRoot);
        } else {
            console.warn('Missing ast stylesheet!!!', ast.type, ast.stylesheet);
        }

        return resolve([...criticalSelectors]);
    }).catch(error => {
        console.log('Extraction Error');
        console.error(error.name);
        console.error(error.message);
    });
};

const debug = doDebug('crittr:Crittr.class');
const readFilePromise = util.promisify(fs.readFile);
const devices = puppeteer.devices;
puppeteer.use(StealthPlugin());

/**
 * CRITTR Class
 */
class Crittr {
    /**
     * Crittr Class to extract critical css from an given url
     *
     * @param {Object}  [options]                               - The options object itself
     * @param {string}  options.css                             - Can be a file path or css string or null
     * @param {number}  [options.timeout=30000]                 - After this time the navigation to the page will be stopped. Prevents
     *                                                          execution time explosion
     * @param {number}  [options.pageLoadTimeout=2000]          - after load event of page this time is set to wait for x seconds
     *                                                          until the page load is manually stopped
     * @param {Object}  [options.browser]                       - Browser configuration object
     * @param {Object}  [options.device]                        - Device configuration object
     * @param {Object}  [options.puppeteer]                     - Puppeteer configuration object
     * @param {Boolean} [options.printBrowserConsole=false]     - Enables browser console output to stdout if set to true.
     * @param {Boolean} [options.dropKeyframes=true]            - Drops keyframe rules if set to true.
     * @param {Boolean} [options.dropKeyframes=true]            - Drops keyframe rules if set to true.
     * @param {Array}   [options.keepSelectors=[]]              - Array list of selectors which have to be kept in
     *                                                          critical css even if they are NOT part of it
     * @param {Array}   [options.removeSelectors=[]]            - Array list of selectors which have to be removed in
     *                                                          critical css even if they are part of it
     * @param {Array}   [options.blockRequests=[...]            - URLs of websites mostly used to be part of tracking or
     *                                                          analytics. Not needed for critical css so they are aborted
     *
     * @returns Promise<[<string>,<string>]>
     */
    constructor(options) {
        this.options = {
            css: null,
            urls: [],
            timeout: DEFAULTS.TIMEOUT,
            pageLoadTimeout: DEFAULTS.PAGE_LOAD_TIMEOUT,
            outputRemainingCss: DEFAULTS.OUTPUT_REMAINING_CSS,
            browser: {
                userAgent: DEFAULTS.BROWSER_USER_AGENT,
                isCacheEnabled: DEFAULTS.BROWSER_CACHE_ENABLED,
                isJsEnabled: DEFAULTS.BROWSER_JS_ENABLED,
                concurrentTabs: DEFAULTS.BROWSER_CONCURRENT_TABS,
            },
            device: {
                width: DEFAULTS.DEVICE_WIDTH,
                height: DEFAULTS.DEVICE_HEIGHT,
                scaleFactor: DEFAULTS.DEVICE_SCALE_FACTOR,
                isMobile: DEFAULTS.DEVICE_IS_MOBILE,
                hasTouch: DEFAULTS.DEVICE_HAS_TOUCH,
                isLandscape: DEFAULTS.DEVICE_IS_LANDSCAPE,
            },
            puppeteer: {
                browser: null,
                chromePath: null,
                headless: DEFAULTS.PUPPETEER_HEADLESS,
            },
            printBrowserConsole: DEFAULTS.PRINT_BROWSER_CONSOLE,
            dropKeyframes: DEFAULTS.DROP_KEYFRAMES,
            takeScreenshots: DEFAULTS.PAGE_SCREENSHOT,
            screenshotPath: path.join('.'),
            screenshotNameGenerator: DEFAULTS.SCREENSHOT_NAME_GENERATOR,
            keepSelectors: [],
            removeSelectors: [],
            blockRequests: [
                'maps.gstatic.com',
                'maps.googleapis.com',
                'googletagmanager.com',
                'google-analytics.com',
                'google.',
                'googleadservices.com',
                'generaltracking.de',
                'bing.com',
                'doubleclick.net',
            ],
        };
        this.options = merge(this.options, options, {
            isMergeableObject: isPlainObject,
        });

        this._browser = null;
        this._cssTransformator = new CssTransformator();

        // Check device
        if (typeof this.options.device === 'string') {
            if (devices[this.options.device]) {
                this.options.device = devices[this.options.device].viewport;
            } else {
                log.error(
                    "Option 'device' is set as string but has an unknown value. Use devices of puppeteer (https://github.com/GoogleChrome/puppeteer/blob/master/DeviceDescriptors.js) or an object!",
                );
            }
        }

        // Validate some of the options like url and css
        const optionsErrors = this.validateOptions();

        if (optionsErrors.length > 0) {
            optionsErrors.forEach(({ message }) => {
                log.error(message);
            });
            // Exit process when options are invalid
            throw new Error('crittr stopped working. See errors above.');
        }
    }

    /**
     *  Validates parts of the class options to check if they fit the requirements
     *
     * @returns {Array} errors  Array containing errors for options not matching requirements
     */
    validateOptions() {
        const errors = [];
        // Check url
        if (!Array.isArray(this.options.urls)) {
            errors.push({
                message: 'Urls not an Array',
            });
        }

        if (Array.isArray(this.options.urls) && this.options.urls.length === 0) {
            errors.push(new Error('NO URLs to check. Insert at least one url in the urls option!'));
        }

        if (typeof this.options.css !== 'string' && this.options.css !== null) {
            errors.push({
                message: 'css not valid. Expected string got ' + typeof this.options.css,
            });
        }

        if (typeof this.options.screenshotPath !== 'string') {
            errors.push({
                message: 'screenshotPath needs to be a string',
            });
        }
        return errors;
    }

    /**
     * This is our main execution point of the crittr class.
     *
     * @returns {Promise<[<string>, <string>]>}
     */
    run() {
        return new Promise(async (resolve, reject) => {
            debug('run - Starting run ...');

            let criticalCss = '';
            let restCss = '';
            let errors = [];

            try {
                debug('run - Starting browser ...');
                this._browser = await this.getBrowser();
                debug('run - Browser started!');
            } catch (err) {
                debug('run - ERROR: Browser could not be launched ... abort!');
                reject(err);
            }

            try {
                debug('run - Get css content ...');
                this._cssContent = await this.getCssContent();
                debug('run - Get css content done!');
            } catch (err) {
                debug('run - ERROR while extracting css content');
                reject(err);
            }

            try {
                debug('run - Starting critical css extraction ...');
                [criticalCss, restCss, errors] = await this.getCriticalCssFromUrls();
                if (errors.length > 0) {
                    log.warn('Some of the urls had errors. Please review them below!');
                    this.printErrors(errors);
                }
                debug('run - Finished critical css extraction!');
            } catch (err) {
                debug('run - ERROR while critical css extraction');
                reject(err);
            }

            try {
                debug('run - Browser closing ...');

                if (!this.options.puppeteer.browser) {
                    await this._browser.close();
                }

                debug('run - Browser closed!');
            } catch (err) {
                debug('run - ERROR: Browser could not be closed -> already closed?');
            }

            debug('run - Extraction ended!');
            resolve({ critical: criticalCss, rest: restCss });
        });
    }

    /**
     * Returns the browser object of the underlying headless browser
     *
     * @returns {Promise<any>}
     */
    async getBrowser() {
        try {
            if (this.options.puppeteer.browser !== null) {
                console.log('Using existed');
                return await this.options.puppeteer.browser;
            } else {
                const browser = await puppeteer
                    .launch({
                        ignoreHTTPSErrors: true,
                        args: [
                            '--disable-setuid-sandbox',
                            '--no-sandbox',
                            '--ignore-certificate-errors',
                            '--disable-dev-shm-usage',
                            //                        '--no-gpu'
                        ],
                        dumpio: false,
                        headless: this.options.puppeteer.headless,
                        executablePath: this.options.puppeteer.chromePath,
                        devtools: false,
                    })
                    .then(browser => {
                        return browser;
                    });

                return browser;
            }
        } catch (e) {
            throw new Error(e);
        }
    }

    /**
     * Tries to gracefully closes a page obj to ensure the uninterrupted progress of extraction
     *
     * @param page {!Promise<!Puppeteer.Page>}
     * @param errors {Array<Error>}
     * @returns {Promise<any>}
     */
    gracefulClosePage(page, errors) {
        return new Promise(async (resolve, reject) => {
            this.printErrors(errors);

            try {
                debug('gracefulClosePage - Closing page after error gracefully ...');
                await page.close();
                debug('gracefulClosePage - Page closed gracefully!');
            } catch (err) {
                debug('gracefulClosePage - Error while closing page -> already closed?');
            }
            resolve();
        });
    }

    /**
     * Outputs the errors in a readable way to the stdout/stderr
     *
     * @param errors
     */
    printErrors(errors) {
        if (errors) {
            log.warn(chalk.red('Errors occured during processing. Please have a look and report them if necessary'));
            if (Array.isArray(errors)) {
                for (let error of errors) {
                    log.error(error);
                }
            } else {
                log.error(errors);
            }
        }
    }

    /**
     * Returns a page of the underlying browser engine
     *
     * @returns {!Promise<!Puppeteer.Page> | *}
     */
    getPage() {
        return this._browser.newPage();
    }

    /**
     * Tries to get the contents of the given css file or in case of css string returns the string
     *
     * @returns {Promise<any>}
     */
    getCssContent() {
        return new Promise(async (resolve, reject) => {
            if (typeof this.options.css === 'string') {
                let cssString = '';
                if (this.options.css.endsWith('.css')) {
                    try {
                        cssString = await readFilePromise(this.options.css, 'utf8');
                        if (cssString.length === 0) {
                            reject(new Error('No CSS content in file exists -> exit!'));
                        }
                    } catch (err) {
                        reject(err);
                    }
                } else {
                    cssString = this.options.css;
                }

                resolve(cssString);
            } else if (!this.options.css) {
                try {
                    let cssString = await this.getCssFromUrl(this.options.urls[0]);

                    resolve(cssString);
                } catch (e) {
                    reject(e);
                }
            }
        });
    }

    async getCssFromUrl(url) {
        let cssString = '';
        const page = await this.getPage();
        debug('getCssFromUrl - Try to get collect CSS from ' + url);
        await page.coverage.startCSSCoverage();
        await page.goto(url, {
            waitUntil: 'load',
            timeout: this.options.timeout,
        });
        cssString = await page.evaluate(() => {
            return [...document.styleSheets]
                .map(styleSheet => {
                    try {
                        return [...styleSheet.cssRules].map(rule => rule.cssText).join('');
                    } catch (e) {
                        console.log('Access to stylesheet %s is denied. Ignoring...', styleSheet.href);
                    }
                })
                .filter(Boolean)
                .join('\n');
        });

        await page.close();

        return cssString;
    }

    /**
     *
     * Starts an url evaluation with all operations to extract the critical css
     *
     * @returns {Promise<[<Object>, <Object>, <Array>]>}
     */
    getCriticalCssFromUrls() {
        return new Promise(async (resolve, reject) => {
            let errors = [];
            const urls = this.options.urls;
            const criticalAstSets = new Set();
            const restAstSets = new Set();
            const sourceCssAst = this._cssTransformator.getAst(this._cssContent);

            const queue = new Queue({
                maxConcurrency: this.options.browser.concurrentTabs,
            });

            // Add to queue

            const queueEvaluateFn = async (url, sourceCssAst, criticalAstSets, restAstSets) => {
                try {
                    debug('getCriticalCssFromUrls - Try to get critical ast from ' + url);
                    const [criticalAst, restAst] = await this.evaluateUrl(url, sourceCssAst);
                    criticalAstSets.add(criticalAst);
                    restAstSets.add(restAst);
                    debug('getCriticalCssFromUrls - Successfully extracted critical ast!');
                } catch (err) {
                    debug('getCriticalCssFromUrls - ERROR getting critical ast from promise');
                    log.error('Could not get critical ast for url ' + url);
                    log.error(err);
                    errors.push(err);
                }
            };

            for (let url of urls) {
                queue.add(1, queueEvaluateFn, [url, sourceCssAst, criticalAstSets, restAstSets]);
            }

            queue
                .run()
                .then(async () => {
                    if (criticalAstSets.size === 0) {
                        reject(errors);
                    }

                    // remember to use wildcards. Greedy seems to be the perfect fit
                    // Just *selector* matches all selector that have at least selector in their string
                    // *sel* needs only sel and so on

                    // Create the Rule Maps for further iteration
                    debug('getCriticalCssFromUrls - Merging multiple atf ast objects. Size: ' + criticalAstSets.size);
                    let atfRuleMap = new Map();
                    for (let astObj of criticalAstSets) {
                        try {
                            // Merge all extracted ASTs into a final one
                            atfRuleMap = Ast.generateRuleMap(astObj, atfRuleMap);
                        } catch (err) {
                            debug('getCriticalCssFromUrls - ERROR merging multiple atf ast objects');
                            reject(err);
                        }
                    }
                    debug('getCriticalCssFromUrls - Merging multiple atf ast objects - finished');

                    // Only do the more time consuming steps if needed
                    let restRuleMap = new Map();
                    if (this.options.outputRemainingCss) {
                        debug('getCriticalCssFromUrls - Merging multiple rest ast objects. Size: ' + restAstSets.size);
                        for (let astObj of restAstSets) {
                            try {
                                // Merge all extracted ASTs into a final one
                                restRuleMap = Ast.generateRuleMap(astObj, restRuleMap);
                            } catch (err) {
                                debug('getCriticalCssFromUrls - ERROR merging multiple rest ast objects');
                                reject(err);
                            }
                        }
                        debug('getCriticalCssFromUrls - Merging multiple rest ast objects - finished');

                        // Filter rules out of restRuleMap which already exists in atfRuleMap
                        debug('getCriticalCssFromUrls - Filter duplicates of restMap');
                        for (const [atfRuleKey, atfRuleObj] of atfRuleMap) {
                            // Check if ruleKey exists in restMap
                            // If not it is only in atfMap. This is the wanted behaviour
                            if (restRuleMap.has(atfRuleKey)) {
                                // Get the rules array for the rule key
                                let restRuleArr = restRuleMap.get(atfRuleKey);
                                // RestMap has the same ruleKey as atf. We need to check now if the rules in this key match
                                // But before we divide between media rules and rules
                                restRuleArr = restRuleArr.filter(ruleObj => !atfRuleObj.some(atfRule => ruleObj.hash === atfRule.hash));
                                if (restRuleArr.length > 0) {
                                    restRuleMap.set(atfRuleKey, restRuleArr);
                                } else {
                                    restRuleMap.delete(atfRuleKey);
                                }
                            }
                        }
                        debug('getCriticalCssFromUrls - Filter duplicates of restMap - finished');
                    }

                    // CleanCSS Config
                    const ccss = new CleanCSS({
                        compatibility: '*',
                        properties: {
                            backgroundClipMerging: false, // controls background-clip merging into shorthand
                            backgroundOriginMerging: false, // controls background-origin merging into shorthand
                            backgroundSizeMerging: false, // controls background-size merging into shorthand
                            colors: false, // controls color optimizations
                            ieBangHack: false, // controls keeping IE bang hack
                            ieFilters: false, // controls keeping IE `filter` / `-ms-filter`
                            iePrefixHack: false, // controls keeping IE prefix hack
                            ieSuffixHack: false, // controls keeping IE suffix hack
                            merging: true, // controls property merging based on understandability
                            shorterLengthUnits: false, // controls shortening pixel units into `pc`, `pt`, or `in` units
                            spaceAfterClosingBrace: true, // controls keeping space after closing brace - `url() no-repeat` into `url()no-repeat`
                            urlQuotes: true, // controls keeping quoting inside `url()`
                            zeroUnits: false, // controls removal of units `0` value
                        },
                        selectors: {
                            adjacentSpace: false, // controls extra space before `nav` element
                            ie7Hack: true, // controls removal of IE7 selector hacks, e.g. `*+html...`
                            mergeLimit: 1000, // controls maximum number of selectors in a single rule (since 4.1.0)
                            multiplePseudoMerging: false, // controls merging of rules with multiple pseudo classes / elements (since 4.1.0)
                        },
                        level: {
                            1: {
                                all: false,
                                cleanupCharsets: true, // controls `@charset` moving to the front of a stylesheet; defaults to `true`
                                removeWhitespace: false, // controls removing unused whitespace; defaults to `true`
                            },
                            2: {
                                mergeAdjacentRules: true, // controls adjacent rules merging; defaults to true
                                mergeIntoShorthands: false, // controls merging properties into shorthands; defaults to true
                                mergeMedia: true, // controls `@media` merging; defaults to true
                                mergeNonAdjacentRules: true, // controls non-adjacent rule merging; defaults to true
                                mergeSemantically: false, // controls semantic merging; defaults to false
                                overrideProperties: true, // controls property overriding based on understandability; defaults to true
                                removeEmpty: true, // controls removing empty rules and nested blocks; defaults to `true`
                                reduceNonAdjacentRules: true, // controls non-adjacent rule reducing; defaults to true
                                removeDuplicateFontRules: true, // controls duplicate `@font-face` removing; defaults to true
                                removeDuplicateMediaBlocks: true, // controls duplicate `@media` removing; defaults to true
                                removeDuplicateRules: true, // controls duplicate rules removing; defaults to true
                                removeUnusedAtRules: false, // controls unused at rule removing; defaults to false (available since 4.1.0)
                                restructureRules: false, // controls rule restructuring; defaults to false
                            },
                        },
                    });

                    // Create the AST Objects out of the RuleMaps to being able to convert them to CSS again
                    debug('getCriticalCssFromUrls - Creating AST Object of atf ruleMap');
                    let finalAtfAst = Ast.getAstOfRuleMap(atfRuleMap);
                    let finalCss = this._cssTransformator.getCssFromAst(finalAtfAst);
                    // Minify css
                    finalCss = ccss.minify(finalCss).styles;
                    // Sort media queries
                    finalCss = await postcss([
                        sortMediaQueries({
                            sort: 'mobile-first', // default
                            onlyTopLevel: true,
                        }),
                        pruneVar(),
                        removeDuplicateVariables(),
                    ]).process(finalCss, { from: undefined }).css;

                    // Handle restCSS
                    let finalRestCss = '';
                    if (this.options.outputRemainingCss) {
                        debug('getCriticalCssFromUrls - Filter duplicates of restMap');
                        // Iterate over atfRules to remove them from restRules
                        for (const [atfRuleKey, atfRuleObj] of atfRuleMap) {
                            // Check if ruleKey exists in restMap
                            // If not it is only in atfMap. This is the wanted behaviour
                            if (restRuleMap.has(atfRuleKey)) {
                                // Get the rules array for the rule key
                                let restRuleArr = restRuleMap.get(atfRuleKey);
                                // RestMap has the same ruleKey as atf. We need to check now if the rules in this key match
                                // But before we divide between media rules and rules
                                restRuleArr = restRuleArr.filter(ruleObj => !atfRuleObj.some(atfRule => ruleObj.hash === atfRule.hash));
                                if (restRuleArr.length > 0) {
                                    restRuleMap.set(atfRuleKey, restRuleArr);
                                } else {
                                    restRuleMap.delete(atfRuleKey);
                                }
                            }
                        }
                        debug('getCriticalCssFromUrls - Filter duplicates of restMap - finished');

                        let finalRestAst = Ast.getAstOfRuleMap(restRuleMap); // Create an AST object of a crittr rule map
                        finalRestCss = this._cssTransformator.getCssFromAst(finalRestAst); // Transform AST back to css
                        finalRestCss = ccss.minify(finalRestCss).styles; // remove and merge remaining dupes
                        // Resort media queries.
                        finalRestCss = await postcss([
                            sortMediaQueries({
                                sort: 'mobile-first', // default
                            }),
                        ]).process(finalRestCss, { from: undefined }).css;
                    }

                    resolve([finalCss, finalRestCss, errors]);
                })
                .catch(err => {
                    reject(err);
                });
        }); // End of Promise
    }

    /**
     * Evaluates an url and returns the critical AST Object
     *
     * @param url
     * @param sourceAst
     * @returns {Promise<Object>}
     */
    evaluateUrl(url, sourceAst) {
        return new Promise(async (resolve, reject) => {
            let retryCounter = 3;
            let hasError = false;
            let page = null;
            let criticalSelectorsMap = new Map();
            let criticalAstObj = null;
            let restAstObj = null;

            const getPage = async () => {
                return new Promise((resolve, reject) => {
                    try {
                        this.getPage()
                            .then(page => {
                                resolve(page);
                            })
                            .catch(err => {
                                if (retryCounter-- > 0) {
                                    log.warn('Could not get page from browser. Retry ' + retryCounter + ' times.');
                                    resolve(getPage());
                                } else {
                                    log.warn('Tried to get page but failed. Abort now ...');
                                    reject(err);
                                }
                            });
                    } catch (err) {
                        reject(err);
                    }
                });
            };

            try {
                debug('evaluateUrl - Open new Page-Tab ...');
                page = await getPage();
                if (this.options.printBrowserConsole === true) {
                    page.on('console', msg => {
                        const args = msg.args();
                        for (let i = 0; i < args.length; ++i) log.log(`${args[i]}`);
                    });

                    page.on('pageerror', err => {
                        log.log('Page error: ' + err.toString());
                    });

                    page.on('error', err => {
                        log.log('Error: ' + err.toString());
                    });
                }
                debug('evaluateUrl - Page-Tab opened!');
            } catch (err) {
                debug('evaluateUrl - Error while opening page tab -> abort!');
                hasError = err;
            }

            // Set Page properties
            if (hasError === false) {
                try {
                    let browserOptions = this.options.browser;
                    let deviceOptions = this.options.device;
                    debug('evaluateUrl - Set page properties ...');
                    await page.setCacheEnabled(browserOptions.isCacheEnabled); // Disables cache
                    await page.setJavaScriptEnabled(browserOptions.isJsEnabled);
                    //                await page.setExtraHTTPHeaders("");
                    await page.setRequestInterception(true);

                    const blockRequests = this.options.blockRequests;

                    // Remove tracking from pages (at least the well known ones
                    page.on('request', interceptedRequest => {
                        const url = interceptedRequest.url();
                        if (blockRequests) {
                            for (const blockedUrl of blockRequests) {
                                if (url.includes(blockedUrl)) {
                                    interceptedRequest.abort();
                                    return;
                                }
                            }
                        }
                        interceptedRequest.continue();
                    });

                    // For DEBUG reasons
                    //                    page.on('load', () => {
                    //                        debug("EVENT: load - triggered for " + page.url());
                    //                    });

                    //                    page.on('requestfailed', request => {
                    //                        startedRequests.splice(startedRequests.indexOf(request.url()), 1);
                    //                    });
                    //
                    //                    page.on('requestfinished', request => {
                    //                        startedRequests.splice(startedRequests.indexOf(request.url()), 1);
                    //                    });

                    page.on('error', err => {
                        hasError = err;
                    });

                    await page.emulate({
                        viewport: {
                            width: deviceOptions.width,
                            height: deviceOptions.height,
                            deviceScaleFactor: deviceOptions.scaleFactor,
                            isMobile: deviceOptions.isMobile,
                            hasTouch: deviceOptions.hasTouch,
                            isLandscape: deviceOptions.isLandscape,
                        },
                        userAgent: browserOptions.userAgent,
                    });

                    debug('evaluateUrl - Page properties set!');
                } catch (err) {
                    debug('evaluateUrl - Error while setting page properties -> abort!');
                    hasError = err;
                }
            }

            // Go to destination page
            if (hasError === false) {
                // TODO: handle goto errors with retry
                try {
                    debug('evaluateUrl - Navigating page to ' + url);

                    // CHeck if url is local or web
                    if (this.isLocalFile(url)) {
                        // Clear file url from parameters because we don't need them
                        if (url.includes('?')) {
                            url = url.substring(0, url.indexOf('?'));
                        }
                        if (url.includes('#')) {
                            url = url.substring(0, url.indexOf('#'));
                        }

                        const htmlContent = await fs.readFile(path.join(DEFAULTS.PROJECT_DIR, url), 'utf8');
                        await page.setContent(htmlContent);
                    } else {
                        await page.goto(url, {
                            timeout: this.options.timeout,
                            waitUntil: ['networkidle2'],
                        });
                    }

                    debug('evaluateUrl - Page navigated');
                } catch (err) {
                    debug('evaluateUrl - Error while page.goto -> ' + url);
                    hasError = err;
                }
            }

            if (hasError === false) {
                try {
                    debug('evaluateUrl - Extracting critical selectors');
                    await new Promise(r => setTimeout(r, 250));
                    if (this.options.takeScreenshots === true) {
                        let screenName = url.replace(/[^\w\s]/gi, '_') + '.png';
                        if (typeof this.options.screenshotNameGenerator === 'function') {
                            const screenGeneratedName = await this.options.screenshotNameGenerator(url);
                            screenName = `${screenGeneratedName}.png`;
                        }

                        await fs.mkdirp(this.options.screenshotPath);

                        await page.screenshot({
                            path: path.join(this.options.screenshotPath, screenName),
                            type: 'png',
                        });
                    }

                    criticalSelectorsMap = new Map(
                        await page.evaluate(extractCriticalCss_script, {
                            sourceAst: sourceAst,
                            loadTimeout: this.options.pageLoadTimeout,
                            keepSelectors: this.options.keepSelectors,
                            removeSelectors: this.options.removeSelectors,
                            dropKeyframes: this.options.dropKeyframes,
                        }),
                    );
                    debug('evaluateUrl - Extracting critical selectors - successful! Length: ' + criticalSelectorsMap.size);
                } catch (err) {
                    debug('evaluateUrl - Error while extracting critical selectors -> not good!');
                    hasError = err;
                }

                debug('evaluateUrl - cleaning up AST with criticalSelectorMap');
                const [criticalAst, restAst] = this._cssTransformator.filterByMap(sourceAst, criticalSelectorsMap);
                criticalAstObj = criticalAst;
                restAstObj = restAst;

                debug('evaluateUrl - cleaning up AST with criticalSelectorMap - END');
            }

            if (hasError === false) {
                try {
                    debug('evaluateUrl - Closing page ...');
                    await page.close();
                    debug('evaluateUrl - Page closed');
                } catch (err) {
                    hasError = err;
                    debug('evaluateUrl - Error while closing page -> already closed?');
                }
            }

            // Error handling
            if (hasError !== false) {
                try {
                    await this.gracefulClosePage(page, hasError);
                } catch (err) {}
                reject(hasError);
            }

            resolve([criticalAstObj, restAstObj]);
        });
    }

    isLocalFile(url) {
        let isLocalFile = true;

        try {
            const tmpUrl = new URL(url);
            debug(`{url} is a real url`);
            isLocalFile = false;
        } catch (e) {
            debug(`{url} is a local file`);
        }

        return isLocalFile;
    }
}

url.fileURLToPath(new URL('.', import.meta.url));
process.env.NODE_ENV || 'production';

let IS_NPM_PACKAGE = false;
try {
    const require = createRequire$1(import.meta.url);
    IS_NPM_PACKAGE = !!require.resolve('crittr');
} catch (e) {}

/**
 *
 * @param options
 * @returns {Promise<[<string>, <string>]>}
 */
var index = async options => {
    log.time('Crittr Run');

    let crittr;
    let resultObj = { critical: null, rest: null };

    crittr = new Crittr(options);

    resultObj = await crittr.run();

    log.timeEnd('Crittr Run');
    return resultObj;
};

export { index as default };
