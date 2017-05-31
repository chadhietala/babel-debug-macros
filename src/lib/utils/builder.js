export default class Builder {
  constructor(t, options) {
    this.t = t;
    this.module = options.module;
    this.global = options.global;
    this.assertPredicateIndex = options.assertPredicateIndex;
    this.expressions = [];
  }

  /**
   * Expands:
   *
   * assert($PREDICATE, $MESSAGE)
   *
   * into
   *
   * ($DEBUG && console.assert($PREDICATE, $MESSAGE));
   *
   * or (when `assertPredicateIndex` specified)
   *
   * ($DEBUG && $PREDICATE && console.assert(false, $MESSAGE));
   *
   * or (`{ externalizeHelpers: { module: true } }`)
   *
   * ($DEBUG && assert($PREDICATE, $MESSAGE));
   *
   * or (when `{ externalizeHelpers: { module: true }, debugTools: { source: '...', assertPredicateIndex: 0 } }` specified)
   *
   * ($DEBUG && $PREDICATE && assert(false, $MESSAGE));
   *
   * or (when `{ externalizeHelpers: { global: '$GLOBLA_NS' }` specified)
   *
   * ($DEBUG && $GLOBAL_NS.assert($PREDICATE, $MESSAGE));
   *
   * or (when `{ externalizeHelpers: { global: '$GLOBLA_NS' }, debugTools: { source: '...', assertPredicateIndex: 0 } }` specified)
   *
   * ($DEBUG && $PREDICATE && $GLOBAL_NS.assert(false, $MESSAGE));
   */
  assert(path) {
    let predicate;
    if (this.assertPredicateIndex !== undefined) {
      predicate = (expression, args) => {
        let predicate = args[this.assertPredicateIndex];
        args[this.assertPredicateIndex] = this.t.identifier('false');

        return predicate;
      };
    }

    this._createMacroExpression(path, {
      predicate
    });
  }

  /**
   * Expands:
   *
   * warn($MESSAGE)
   *
   * into
   *
   * ($DEBUG && console.warn($MESSAGE));
   *
   * or
   *
   * ($DEBUG && warn($MESSAGE));
   *
   * or
   *
   * ($DEBUG && $GLOBAL_NS.warn($MESSAGE));
   */
  warn(path) {
    this._createMacroExpression(path);
  }

  /**
   * Expands:
   *
   * log($MESSAGE)
   *
   * into
   *
   * ($DEBUG && console.log($MESSAGE));
   *
   * or
   *
   * ($DEBUG && log($MESSAGE));
   *
   * or
   *
   * ($DEBUG && $GLOBAL_NS.log($MESSAGE));
   */
  log(path) {
    this._createMacroExpression(path);
  }

  _createMacroExpression(path, _options) {
    let options = _options || {};

    let { t, module, global } = this;
    let expression = path.node.expression;
    let { callee, arguments: args } = expression;
    let callExpression;

    if (options.validate) {
      options.validate(expression, args);
    }

    if (module || global) {
      if (global) {
        callExpression = this._createGlobalExternalHelper(callee, args, global);
      } else {
        callExpression = expression;
      }
    } else if (options.buildConsoleAPI) {
      callExpression = options.buildConsoleAPI(expression, args);
    } else {
      callExpression = this._createConsoleAPI(options.consoleAPI || callee, args);
    }

    let identifiers = this._getIdentifiers(args);
    let prefixedIdentifiers = [];

    if (options.predicate) {
      let predicate = options.predicate(expression, args) || t.identifier('false');
      let negatedPredicate = t.unaryExpression('!', t.parenthesizedExpression(predicate));
      prefixedIdentifiers.push(negatedPredicate);
    }

    this.expressions.push([path, this._buildLogicalExpressions(prefixedIdentifiers, callExpression)]);
  }

  /**
   * Expands:
   *
   * deprecate($MESSAGE, $PREDICATE)
   *
   * or
   *
   * deprecate($MESSAGE, $PREDICATE, {
   *  $ID,
   *  $URL,
   *  $UNIL
   * });
   *
   * into
   *
   * ($DEBUG && $PREDICATE && console.warn($MESSAGE));
   *
   * or
   *
   * ($DEBUG && $PREDICATE && deprecate($MESSAGE, false, { $ID, $URL, $UNTIL }));
   *
   * or
   *
   * ($DEBUG && $PREDICATE && $GLOBAL_NS.deprecate($MESSAGE, false, { $ID, $URL, $UNTIL }));
   */
  deprecate(path) {
    this._createMacroExpression(path, {
      predicate: (expression, args) => {
        let [, predicate] = args;
        args[1] = this.t.identifier('false');

        return predicate;
      },

      buildConsoleAPI: (expression, args) => {
        let [message] = args;

        return this._createConsoleAPI(this.t.identifier('warn'), [message]);
      },

      validate: (expression, args) => {
        let [ , , meta ] = args;

        if (meta && meta.properties && !meta.properties.some( prop =>  prop.key.name === 'id')) {
          throw new ReferenceError(`deprecate's meta information requires an "id" field.`);
        }

        if (meta && meta.properties && !meta.properties.some(prop =>  prop.key.name === 'until')) {
          throw new ReferenceError(`deprecate's meta information requires an "until" field.`);
        }
      }
    });
  }

  /**
   * Performs the actually expansion of macros
   */
  expandMacros(debugFlag) {
    let { t } = this;
    let flag = t.booleanLiteral(debugFlag);
    for (let i = 0; i < this.expressions.length; i++) {
      let [exp, logicalExp] = this.expressions[i];
      exp.replaceWith(t.parenthesizedExpression(logicalExp(flag)));
    }
  }

  _getIdentifiers(args) {
    return args.filter((arg) => this.t.isIdentifier(arg));
  }

  _createGlobalExternalHelper(identifier, args, ns) {
    let { t } = this;
    return t.callExpression(t.memberExpression(t.identifier(ns), identifier), args);
  }

  _createConsoleAPI(identifier, args) {
    let { t } = this;
    return t.callExpression(t.memberExpression(t.identifier('console'), identifier), args);
  }

  _buildLogicalExpressions(identifiers, callExpression) {
    let { t } = this;

    return (debugIdentifier) => {
      identifiers.unshift(debugIdentifier);
      identifiers.push(callExpression);
      let logicalExpressions;

        for (let i = 0; i < identifiers.length; i++) {
          let left = identifiers[i];
          let right = identifiers[i + 1];
          if (!logicalExpressions) {
            logicalExpressions = t.logicalExpression('&&', left, right);
          } else if (right) {
            logicalExpressions = t.logicalExpression('&&', logicalExpressions, right)
          }
        }

      return logicalExpressions;
    }
  }
}
