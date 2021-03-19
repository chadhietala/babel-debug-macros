'use strict';

const Builder = require('./builder');

const SUPPORTED_MACROS = ['assert', 'deprecate', 'warn', 'log'];

module.exports = class Macros {
  constructor(babel, options) {
    this.babel = babel;
    this.localDebugBindings = [];

    this.debugHelpers = options.externalizeHelpers || {};
    this.builder = new Builder(babel.types, {
      module: this.debugHelpers.module,
      global: this.debugHelpers.global,
      assertPredicateIndex: options.debugTools && options.debugTools.assertPredicateIndex,
      isDebug: options.debugTools.isDebug,
    });
  }

  /**
   * Injects the either the env-flags module with the debug binding or
   * adds the debug binding if missing from the env-flags module.
   */
  expand(path) {
    this.builder.expandMacros();

    this._cleanImports(path);
  }

  /**
   * Collects the import bindings for the debug tools.
   */
  collectDebugToolsSpecifiers(specifiers) {
    specifiers.forEach(specifier => {
      if (specifier.node.imported && SUPPORTED_MACROS.indexOf(specifier.node.imported.name) > -1) {
        this.localDebugBindings.push(specifier);
      }
    });
  }

  /**
   * Builds the expressions that the CallExpression will expand into.
   */
  build(path) {
    let expression = path.node.expression;

    if (
      this.builder.t.isCallExpression(expression) &&
      this.localDebugBindings.some(b => b.get('local').node.name === expression.callee.name)
    ) {
      let specifier = path.scope.getBinding(expression.callee.name).path.node;
      let imported = specifier.imported.name;
      // The builder needs to be made aware of the the local name of the ImportSpecifier
      this.builder[`${imported}`](path, {
        localName: specifier.local.name,
        importedName: imported,
      });
    }
  }

  _cleanImports() {
    if (!this.debugHelpers.module) {
      if (this.localDebugBindings.length > 0) {
        let importPath = this.localDebugBindings[0].findParent(p => p.isImportDeclaration());
        if (importPath === null) {
          // import declaration in question seems to have already been removed
          return;
        }

        let specifiers = importPath.get('specifiers');

        if (specifiers.length === this.localDebugBindings.length) {
          importPath.remove();
        } else {
          this.localDebugBindings.forEach(binding => {
            let specifier = binding.get('local').parentPath;
            let importPath = specifier.parentPath;

            if (importPath.get('specifiers').length === 1) {
              importPath.remove();
            } else {
              specifier.remove();
            }
          });
        }
      }
    }
  }
};
