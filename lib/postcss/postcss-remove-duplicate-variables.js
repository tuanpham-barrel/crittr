export default () => {
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
