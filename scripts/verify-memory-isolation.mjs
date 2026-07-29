import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

/**
 * Structural / path-aware verification of the memory-write security boundary.
 *
 * Guarantee (honest): the checker confirms that every write-reaching straight-line path inside
 * `executeMemoryWrite` contains the required stages in order, or conservatively rejects ambiguous
 * control flow. It is target-specific and fail-closed. It is not a full interprocedural TypeScript
 * proof and not formal verification. Ambiguity is failure, not a warning.
 *
 * Build 2.1J-R2 additions:
 * - Unreachable statements after unconditional return/throw (and both-branch terminating if)
 *   cannot credit security stages (UNREACHABLE_SECURITY_STAGE).
 * - Approval lookup/validate/consume are accepted only inside the canonical gated AST sequence.
 * - Security stages hidden in object/array/ternary/logical/comma/template containers fail closed.
 *
 * Build 2.1J-R3 additions:
 * - Strict canonical AST allowlist: labels, loops, switch, try/catch/finally, break/continue and
 *   other unsupported control-flow fail closed as UNSUPPORTED_CONTROL_FLOW even without stages.
 * - Approval-required gate condition is proven via AST property chains / string literals only
 *   (no getText-based security decisions).
 *
 * Build 2.1J-R4 additions:
 * - Recognized executeMemoryWrite generator targets (function-star / async function-star, with or
 *   without yield) fail closed as UNSUPPORTED_CONTROL_FLOW before body/stage accounting (REV9-001).
 */

const failures = [];
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const parse = (path) => {
  if (!existsSync(path)) {
    failures.push(`ZERO_FILES: ${path} is missing.`);
    return null;
  }
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
};

const callName = (source, node) => {
  if (!ts.isCallExpression(node)) return null;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.getText(source);
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  return null;
};

const findFunctionsNamed = (source, name) => {
  const found = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)),
      )
    ) {
      for (const declaration of node.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        )
          found.push(declaration.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const STAGE_ALIASES = Object.freeze({
  validateOperationContext: 'context-validation',
  normalizeMemoryWriteContent: 'input-normalization',
  markUntrusted: 'untrusted-marking',
  'deps.scanner.scanText': 'text-scan',
  'deps.scanner.scanMetadata': 'metadata-scan',
  classifyData: 'privacy-classification',
  classificationFor: 'privacy-classification',
  authorizeMemoryAccess: 'namespace-authorization',
  'deps.policy.evaluate': 'memory-policy',
  deriveMemoryWriteApprovalDemand: 'approval-demand-derivation',
  'deps.approvals.lookup': 'approval-lookup',
  validateApproval: 'approval-validation',
  'deps.approvals.consume': 'approval-consumption',
  'deps.memory.write': 'memory-write',
  'deps.audit.record': 'safe-audit',
  readTrustedTimestamp: 'trusted-clock',
});

const DIRECT_FUNCTION_STAGES = new Set(
  Object.keys(STAGE_ALIASES).filter((name) => !name.includes('.')),
);
const DIRECT_PROPERTY_STAGES = new Set(
  Object.keys(STAGE_ALIASES).filter((name) => name.includes('.')),
);
const SECURITY_PORT_ROOTS = new Set([
  'deps.scanner',
  'deps.policy',
  'deps.approvals',
  'deps.memory',
  'deps.audit',
]);

/**
 * Conservative canonical-call policy. Security stage functions may appear only as the direct
 * callee of their approved call expression. Saving, destructuring, binding, passing, returning,
 * wrapping, optional access and computed access all fail closed.
 */
const rejectIndirectSecurityReferences = (source, target, failuresOut) => {
  const directCall = (node) =>
    ts.isCallExpression(node.parent) &&
    node.parent.expression === node &&
    !node.parent.questionDotToken &&
    !(ts.isPropertyAccessExpression(node) && node.questionDotToken);

  const allowedRootUse = (node) => {
    const parent = node.parent;
    if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) return false;
    if (!DIRECT_PROPERTY_STAGES.has(parent.getText(source))) return false;
    return directCall(parent);
  };

  const allowedDependencyUse = (node) => {
    const member = node.parent;
    if (!ts.isPropertyAccessExpression(member) || member.expression !== node) return false;
    const text = member.getText(source);
    if (SECURITY_PORT_ROOTS.has(text)) return allowedRootUse(member);
    if (text !== 'deps.clock') return false;
    const call = member.parent;
    return (
      ts.isCallExpression(call) &&
      call.arguments.includes(member) &&
      callName(source, call) === 'readTrustedTimestamp'
    );
  };

  const visit = (node) => {
    if (ts.isElementAccessExpression(node)) {
      const base = node.expression.getText(source);
      if (
        SECURITY_PORT_ROOTS.has(base) ||
        [...SECURITY_PORT_ROOTS].some((root) => base.startsWith(`${root}.`))
      )
        failuresOut.push(
          'AMBIGUOUS_SECURITY_REFERENCE: computed security-stage access is forbidden.',
        );
    } else if (ts.isPropertyAccessExpression(node)) {
      const text = node.getText(source);
      if (DIRECT_PROPERTY_STAGES.has(text) && !directCall(node))
        failuresOut.push(`AMBIGUOUS_SECURITY_REFERENCE: ${text} must be a canonical direct call.`);
      if (SECURITY_PORT_ROOTS.has(text) && !allowedRootUse(node))
        failuresOut.push(
          `AMBIGUOUS_SECURITY_REFERENCE: ${text} cannot be saved, destructured or passed.`,
        );
      if (
        node.questionDotToken &&
        (DIRECT_PROPERTY_STAGES.has(text) || SECURITY_PORT_ROOTS.has(text))
      )
        failuresOut.push(
          'AMBIGUOUS_SECURITY_REFERENCE: optional security-stage access is forbidden.',
        );
    } else if (ts.isIdentifier(node) && node.text === 'deps' && !allowedDependencyUse(node)) {
      failuresOut.push(
        'AMBIGUOUS_SECURITY_REFERENCE: deps cannot be aliased, destructured, passed or accessed optionally.',
      );
    } else if (
      ts.isIdentifier(node) &&
      DIRECT_FUNCTION_STAGES.has(node.text) &&
      !directCall(node)
    ) {
      failuresOut.push(
        `AMBIGUOUS_SECURITY_REFERENCE: ${node.text} must be a canonical direct call.`,
      );
    }
    ts.forEachChild(node, visit);
  };

  if (target.body !== undefined) visit(target.body);
};

const REQUIRED_ORDER = Object.freeze([
  'context-validation',
  'trusted-clock',
  'input-normalization',
  'untrusted-marking',
  'text-scan',
  'metadata-scan',
  'privacy-classification',
  'namespace-authorization',
  'memory-policy',
  'approval-demand-derivation',
  'approval-lookup',
  'approval-validation',
  'approval-consumption',
  'memory-write',
  'safe-audit',
]);

const stageOf = (source, node) => {
  const name = callName(source, node);
  if (name === null) return null;
  return STAGE_ALIASES[name] ?? null;
};

const isStageCall = (source, node) => stageOf(source, node) !== null;

const unwrapExpression = (node) => {
  let current = node;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current))
    current = current.expression;
  return current;
};

const isNestedExecutableBoundary = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isClassDeclaration(node) ||
  ts.isClassExpression(node) ||
  ts.isClassStaticBlockDeclaration(node);

/**
 * Collects direct call expressions inside a function body only. Nested function declarations and
 * every other nested executable boundary are skipped so dead helpers cannot satisfy the order.
 */
export function collectDirectCalls(source, functionNode) {
  const body = functionNode.body;
  if (!body) return null;
  const calls = [];
  const visit = (node, insideNestedFunction) => {
    if (
      insideNestedFunction === false &&
      isNestedExecutableBoundary(node) &&
      node !== functionNode
    ) {
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    if (insideNestedFunction === false && ts.isCallExpression(node)) {
      const name = callName(source, node);
      if (name !== null)
        calls.push({
          name,
          position: node.getStart(source),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
    }
    ts.forEachChild(node, (child) => visit(child, insideNestedFunction));
  };
  if (ts.isBlock(body)) for (const statement of body.statements) visit(statement, false);
  else visit(body, false);
  return calls.sort((left, right) => left.position - right.position);
}

const findStageCallsDeep = (source, root, into, includeNested = false) => {
  const visit = (node) => {
    if (!includeNested && node !== root && isNestedExecutableBoundary(node)) return;
    if (ts.isCallExpression(node) && isStageCall(source, node)) into.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
};

const rejectNestedStageBoundaries = (source, target, failuresOut) => {
  const visit = (node) => {
    if (node !== target && isNestedExecutableBoundary(node)) {
      const nested = [];
      findStageCallsDeep(source, node, nested, true);
      if (nested.length > 0)
        failuresOut.push(
          'AMBIGUOUS_CONTROL_FLOW: security stages inside nested executable boundaries are forbidden.',
        );
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (target.body !== undefined) visit(target.body);
};

const APPROVAL_ONLY_STAGES = new Set([
  'approval-lookup',
  'approval-validation',
  'approval-consumption',
]);

/**
 * Control-flow forms that the target-specific checker does not prove. Presence anywhere in the
 * security function body fails closed, even without security stages (REV8-001).
 */
const isUnsupportedControlFlowNode = (node) =>
  ts.isLabeledStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isSwitchStatement(node) ||
  ts.isTryStatement(node) ||
  ts.isBreakStatement(node) ||
  ts.isContinueStatement(node) ||
  ts.isWithStatement(node) ||
  ts.isYieldExpression(node);

/**
 * True when the resolved executeMemoryWrite target itself is a generator
 * (function* / async function*), regardless of yield presence (REV9-001).
 */
const isGeneratorTarget = (target) =>
  (ts.isFunctionDeclaration(target) ||
    ts.isFunctionExpression(target) ||
    ts.isMethodDeclaration(target)) &&
  target.asteriskToken !== undefined;

const rejectUnsupportedControlFlow = (target, failuresOut) => {
  const visit = (node) => {
    if (isUnsupportedControlFlowNode(node)) {
      failuresOut.push(
        'UNSUPPORTED_CONTROL_FLOW: labels, loops, switch, try/catch/finally, break/continue and yield are forbidden.',
      );
      return;
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node !== target &&
      node.asteriskToken !== undefined
    ) {
      failuresOut.push(
        'UNSUPPORTED_CONTROL_FLOW: generator functions are forbidden in the security flow.',
      );
      return;
    }
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isClassStaticBlockDeclaration(node)) &&
      node !== target
    ) {
      // Nested executable bodies are scanned separately for stages; do not walk into them here.
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (target.body !== undefined) visit(target.body);
};

/**
 * True when every path through `statement` ends in return/throw (no fall-through).
 * Unreachable statements after an inner terminator do not restore fall-through.
 */
const statementTerminates = (statement) => {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    let fallThrough = true;
    for (const nested of statement.statements) {
      if (!fallThrough) continue;
      if (statementTerminates(nested)) fallThrough = false;
    }
    return !fallThrough;
  }
  if (ts.isIfStatement(statement)) {
    if (statement.elseStatement === undefined) return false;
    return (
      statementTerminates(statement.thenStatement) && statementTerminates(statement.elseStatement)
    );
  }
  return false;
};

const isLogicalOrCommaOperator = (operator) =>
  operator === ts.SyntaxKind.AmpersandAmpersandToken ||
  operator === ts.SyntaxKind.BarBarToken ||
  operator === ts.SyntaxKind.QuestionQuestionToken ||
  operator === ts.SyntaxKind.CommaToken;

const isExpressionContainer = (node) =>
  ts.isObjectLiteralExpression(node) ||
  ts.isArrayLiteralExpression(node) ||
  ts.isConditionalExpression(node) ||
  ts.isTemplateExpression(node) ||
  ts.isTaggedTemplateExpression(node) ||
  (ts.isBinaryExpression(node) && isLogicalOrCommaOperator(node.operatorToken.kind));

/**
 * Security stages must be direct call expressions on the straight line (or the
 * canonical approval gate). Hiding them in object/array/ternary/logical/comma/
 * template containers fails closed (REV7-003).
 */
const rejectSecurityStagesInExpressionContainers = (source, root, failuresOut) => {
  const visit = (node, insideContainer) => {
    if (node !== root && isNestedExecutableBoundary(node)) return;
    if (isExpressionContainer(node)) {
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    if (insideContainer && ts.isCallExpression(node) && isStageCall(source, node)) {
      failuresOut.push(
        'AMBIGUOUS_CONTROL_FLOW: security stages inside expression containers are forbidden.',
      );
      return;
    }
    ts.forEachChild(node, (child) => visit(child, insideContainer));
  };
  visit(root, false);
};

const rejectUnreachableSecurityStages = (source, root, failuresOut) => {
  const stages = [];
  findStageCallsDeep(source, root, stages, true);
  if (stages.length > 0)
    failuresOut.push(
      'UNREACHABLE_SECURITY_STAGE: security stages after unconditional termination are forbidden.',
    );
};

const creditDirectStageCall = (source, expression, failuresOut, straightLineStages) => {
  rejectSecurityStagesInExpressionContainers(source, expression, failuresOut);
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped)) return;
  const stage = stageOf(source, unwrapped);
  if (stage === null) return;
  if (APPROVAL_ONLY_STAGES.has(stage)) {
    failuresOut.push(
      'AMBIGUOUS_CONTROL_FLOW: naked approval lookup/validate/consume outside the canonical gated sequence is forbidden.',
    );
    return;
  }
  straightLineStages.push({
    stage,
    position: unwrapped.getStart(source),
    name: callName(source, unwrapped),
  });
};

const isCanonicalApprovalCondition = (_source, expression) => {
  const expr = unwrapExpression(expression);
  if (!ts.isBinaryExpression(expr)) return false;
  // Production contract uses strict equality only.
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
  const left = unwrapExpression(expr.left);
  const right = unwrapExpression(expr.right);
  const isApprovalRequiredLiteral = (node) =>
    ts.isStringLiteral(node) && node.text === 'approval-required';
  // Exact production / canonical fixture chain: policyResult.value.decision
  const isDecisionReference = (node) =>
    hasExactPropertyChain(node, ['policyResult', 'value', 'decision']);
  if (isApprovalRequiredLiteral(right) && isDecisionReference(left)) return true;
  // Mirror operand order is intentionally allowed.
  if (isApprovalRequiredLiteral(left) && isDecisionReference(right)) return true;
  return false;
};

const approvalThenHasRequiredStages = (source, thenStatement) => {
  const stages = [];
  findStageCallsDeep(source, thenStatement, stages, false);
  const names = new Set(stages.map((node) => stageOf(source, node)).filter(Boolean));
  return (
    names.has('approval-lookup') &&
    names.has('approval-validation') &&
    names.has('approval-consumption')
  );
};

const propertyChain = (expression) => {
  const parts = [];
  let current = unwrapExpression(expression);
  while (ts.isPropertyAccessExpression(current) && !current.questionDotToken) {
    parts.unshift(current.name.text);
    current = unwrapExpression(current.expression);
  }
  if (!ts.isIdentifier(current)) return null;
  parts.unshift(current.text);
  return parts;
};

const hasExactPropertyChain = (expression, expected) => {
  const actual = propertyChain(expression);
  return (
    actual !== null &&
    actual.length === expected.length &&
    actual.every((part, index) => part === expected[index])
  );
};

const stageAssignment = (source, statement, expectedStage) => {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1)
    return null;
  const [declaration] = statement.declarationList.declarations;
  if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return null;
  const initializer = unwrapExpression(declaration.initializer);
  if (!ts.isCallExpression(initializer) || stageOf(source, initializer) !== expectedStage)
    return null;
  return { name: declaration.name.text, call: initializer };
};

const canonicalResultGuard = (statement, identifier) => {
  if (!ts.isIfStatement(statement) || statement.elseStatement !== undefined) return false;
  const condition = unwrapExpression(statement.expression);
  if (
    !ts.isPrefixUnaryExpression(condition) ||
    condition.operator !== ts.SyntaxKind.ExclamationToken ||
    !hasExactPropertyChain(condition.operand, [identifier, 'ok'])
  )
    return false;
  return statementTerminates(statement.thenStatement);
};

const countBindings = (root, identifier) => {
  let count = 0;
  const countName = (name) => {
    if (ts.isIdentifier(name)) {
      if (name.text === identifier) count += 1;
      return;
    }
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) countName(element.name);
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) countName(node.name);
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)) &&
      node.name?.text === identifier
    )
      count += 1;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
};

const approvalThenUsesResults = (source, thenStatement) => {
  if (!ts.isBlock(thenStatement)) return false;
  const statements = [...thenStatement.statements];
  const assignments = [];
  for (const [index, statement] of statements.entries())
    for (const stage of ['approval-lookup', 'approval-validation', 'approval-consumption']) {
      const assignment = stageAssignment(source, statement, stage);
      if (assignment !== null) assignments.push({ ...assignment, stage, index });
    }
  if (assignments.length !== 3) return false;
  const lookup = assignments.find((entry) => entry.stage === 'approval-lookup');
  const validation = assignments.find((entry) => entry.stage === 'approval-validation');
  const consumption = assignments.find((entry) => entry.stage === 'approval-consumption');
  if (lookup === undefined || validation === undefined || consumption === undefined) return false;
  if (!(lookup.index < validation.index && validation.index < consumption.index)) return false;
  if (
    countBindings(thenStatement, lookup.name) !== 1 ||
    countBindings(thenStatement, validation.name) !== 1 ||
    countBindings(thenStatement, consumption.name) !== 1
  )
    return false;

  const lookupGuard = statements.findIndex(
    (statement, index) => index > lookup.index && canonicalResultGuard(statement, lookup.name),
  );
  const validationGuard = statements.findIndex(
    (statement, index) =>
      index > validation.index && canonicalResultGuard(statement, validation.name),
  );
  const consumptionGuard = statements.findIndex(
    (statement, index) =>
      index > consumption.index && canonicalResultGuard(statement, consumption.name),
  );
  if (
    lookupGuard < 0 ||
    validationGuard < 0 ||
    consumptionGuard < 0 ||
    lookupGuard >= validation.index ||
    validationGuard >= consumption.index
  )
    return false;

  if (
    validation.call.arguments.length < 1 ||
    !hasExactPropertyChain(validation.call.arguments[0], [lookup.name, 'value'])
  )
    return false;
  if (
    consumption.call.arguments.length < 2 ||
    !hasExactPropertyChain(consumption.call.arguments[0], [
      validation.name,
      'value',
      'approvalId',
    ]) ||
    !hasExactPropertyChain(consumption.call.arguments[1], [validation.name, 'value', 'nonce'])
  )
    return false;

  const protectedNames = new Set([lookup.name, validation.name, consumption.name]);
  let reassigned = false;
  const visitAssignments = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(unwrapExpression(node.left)) &&
      protectedNames.has(unwrapExpression(node.left).text)
    )
      reassigned = true;
    ts.forEachChild(node, visitAssignments);
  };
  visitAssignments(thenStatement);
  if (reassigned) return false;

  return true;
};

/**
 * @returns {'not-gate' | 'invalid-gate' | 'valid-gate'}
 */
const classifyApprovalGateIf = (source, statement, failuresOut) => {
  if (!ts.isIfStatement(statement)) return 'not-gate';
  const thenStages = [];
  findStageCallsDeep(source, statement.thenStatement, thenStages, true);
  const elseStages = [];
  if (statement.elseStatement !== undefined)
    findStageCallsDeep(source, statement.elseStatement, elseStages, true);
  const allStages = [...thenStages, ...elseStages];
  if (allStages.length === 0) return 'not-gate';
  const onlyApproval = allStages.every((node) => {
    const stage = stageOf(source, node);
    return stage !== null && APPROVAL_ONLY_STAGES.has(stage);
  });
  if (!onlyApproval) return 'not-gate';
  if (elseStages.length > 0) {
    failuresOut.push('AMBIGUOUS_CONTROL_FLOW: approval stages in else branches are forbidden.');
    return 'invalid-gate';
  }
  if (!isCanonicalApprovalCondition(source, statement.expression)) {
    failuresOut.push(
      'AMBIGUOUS_CONTROL_FLOW: approval gate condition must compare policy decision to approval-required.',
    );
    return 'invalid-gate';
  }
  if (!approvalThenHasRequiredStages(source, statement.thenStatement)) {
    failuresOut.push(
      'AMBIGUOUS_CONTROL_FLOW: approval gate must lookup, validate and consume on the then path.',
    );
    return 'invalid-gate';
  }
  if (!approvalThenUsesResults(source, statement.thenStatement)) {
    failuresOut.push(
      'AMBIGUOUS_CONTROL_FLOW: approval lookup/validation/consume results must be checked.',
    );
    return 'invalid-gate';
  }
  const before = failuresOut.length;
  const visit = (node) => {
    if (ts.isIfStatement(node) && node !== statement) {
      const nestedStages = [];
      findStageCallsDeep(source, node.thenStatement, nestedStages, true);
      if (nestedStages.length === 0 && !statementTerminates(node.thenStatement))
        failuresOut.push(
          'AMBIGUOUS_CONTROL_FLOW: approval deny branch must terminate with return/throw.',
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(statement.thenStatement);
  return failuresOut.length === before ? 'valid-gate' : 'invalid-gate';
};

const statementContainsWrite = (source, statement) => {
  const stages = [];
  findStageCallsDeep(source, statement, stages, true);
  return stages.some((node) => stageOf(source, node) === 'memory-write');
};

const isPureEarlyDenyReturn = (source, statement, failuresOut) => {
  if (!ts.isIfStatement(statement)) return false;
  const thenHasWrite = statementContainsWrite(source, statement.thenStatement);
  const elseHasWrite =
    statement.elseStatement !== undefined &&
    statementContainsWrite(source, statement.elseStatement);
  if (thenHasWrite || elseHasWrite) return false;
  const thenStages = [];
  findStageCallsDeep(source, statement.thenStatement, thenStages, true);
  const elseStages = [];
  if (statement.elseStatement !== undefined)
    findStageCallsDeep(source, statement.elseStatement, elseStages, true);
  if (thenStages.length !== 0 || elseStages.length !== 0) return false;
  if (!statementTerminates(statement.thenStatement)) {
    failuresOut.push('AMBIGUOUS_CONTROL_FLOW: early deny branch must terminate with return/throw.');
    return false;
  }
  if (statement.elseStatement !== undefined && !statementTerminates(statement.elseStatement)) {
    failuresOut.push(
      'AMBIGUOUS_CONTROL_FLOW: early deny else branch must terminate with return/throw.',
    );
    return false;
  }
  return true;
};

const expressionHasAmbiguousStage = (source, expression, failuresOut) => {
  const visit = (node) => {
    if (
      ts.isConditionalExpression(node) ||
      (ts.isBinaryExpression(node) &&
        (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      const nested = [];
      findStageCallsDeep(source, node, nested, true);
      if (nested.length > 0) {
        failuresOut.push(
          'AMBIGUOUS_CONTROL_FLOW: stage/write calls inside conditional or logical expressions are forbidden.',
        );
        return;
      }
    }
    if (isNestedExecutableBoundary(node)) {
      const nested = [];
      findStageCallsDeep(source, node, nested, true);
      if (nested.length > 0) {
        failuresOut.push(
          'AMBIGUOUS_CONTROL_FLOW: stage/write calls inside callbacks or nested functions are forbidden.',
        );
        return;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
};

const analyzeStraightLineBody = (source, functionNode, localFailures) => {
  const body = functionNode.body;
  if (!body || !ts.isBlock(body)) {
    localFailures.push('UNANALYZABLE: executeMemoryWrite body must be a statement block.');
    return [];
  }

  const straightLineStages = [];

  const pushApprovalStagesFromGate = (root) => {
    const stages = [];
    findStageCallsDeep(source, root, stages, false);
    for (const call of stages) {
      const stage = stageOf(source, call);
      if (stage !== null)
        straightLineStages.push({
          stage,
          position: call.getStart(source),
          name: callName(source, call),
        });
    }
  };

  /**
   * @returns {boolean} whether control can fall through past this statement list
   */
  const analyzeStatementList = (statements) => {
    let fallThrough = true;
    for (const statement of statements) {
      if (!fallThrough) {
        rejectUnreachableSecurityStages(source, statement, localFailures);
        continue;
      }

      if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
        if (statement.expression)
          expressionHasAmbiguousStage(source, statement.expression, localFailures);
        if (statement.expression)
          rejectSecurityStagesInExpressionContainers(source, statement.expression, localFailures);
        fallThrough = false;
        continue;
      }

      if (ts.isBlock(statement)) {
        fallThrough = analyzeStatementList(statement.statements);
        continue;
      }

      if (ts.isIfStatement(statement)) {
        const gateKind = classifyApprovalGateIf(source, statement, localFailures);
        if (gateKind === 'valid-gate') {
          if (statementContainsWrite(source, statement)) {
            localFailures.push(
              'AMBIGUOUS_CONTROL_FLOW: memory-write inside the approval gate is forbidden.',
            );
          } else {
            expressionHasAmbiguousStage(source, statement.expression, localFailures);
            rejectSecurityStagesInExpressionContainers(source, statement.expression, localFailures);
            rejectSecurityStagesInExpressionContainers(
              source,
              statement.thenStatement,
              localFailures,
            );
            pushApprovalStagesFromGate(statement.thenStatement);
          }
          // Approval gate deny paths terminate; the non-approval fall-through remains reachable.
          fallThrough = true;
        } else if (gateKind === 'invalid-gate') {
          // Failures already recorded; do not credit approval stages from an invalid gate.
          fallThrough = !statementTerminates(statement);
        } else if (!isPureEarlyDenyReturn(source, statement, localFailures)) {
          localFailures.push(
            'AMBIGUOUS_CONTROL_FLOW: stage/write calls inside if/else branches are forbidden; only early deny returns without stages or the approval gate are allowed.',
          );
          fallThrough = !statementTerminates(statement);
        } else {
          expressionHasAmbiguousStage(source, statement.expression, localFailures);
          rejectSecurityStagesInExpressionContainers(source, statement.expression, localFailures);
          fallThrough = !statementTerminates(statement);
        }
        continue;
      }

      if (
        ts.isLabeledStatement(statement) ||
        ts.isForStatement(statement) ||
        ts.isForInStatement(statement) ||
        ts.isForOfStatement(statement) ||
        ts.isWhileStatement(statement) ||
        ts.isDoStatement(statement) ||
        ts.isSwitchStatement(statement) ||
        ts.isTryStatement(statement) ||
        ts.isBreakStatement(statement) ||
        ts.isContinueStatement(statement) ||
        ts.isWithStatement(statement)
      ) {
        localFailures.push(
          'UNSUPPORTED_CONTROL_FLOW: labels, loops, switch, try/catch/finally, break/continue are forbidden.',
        );
        // Unsupported forms are not modelled; do not credit later stages as reachable through them.
        fallThrough = false;
        continue;
      }

      if (ts.isExpressionStatement(statement)) {
        expressionHasAmbiguousStage(source, statement.expression, localFailures);
        creditDirectStageCall(source, statement.expression, localFailures, straightLineStages);
        continue;
      }

      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (declaration.initializer === undefined) continue;
          expressionHasAmbiguousStage(source, declaration.initializer, localFailures);
          creditDirectStageCall(source, declaration.initializer, localFailures, straightLineStages);
        }
        continue;
      }

      if (ts.isEmptyStatement(statement)) continue;

      localFailures.push(
        'UNSUPPORTED_CONTROL_FLOW: unknown or unsupported statement shape in the security flow.',
      );
      fallThrough = false;
    }
    return fallThrough;
  };

  analyzeStatementList(body.statements);
  return straightLineStages;
};

export function analyzeExecuteMemoryWrite(sourceText, fileName = 'memory-write.service.ts') {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true);
  const localFailures = [];
  const functions = findFunctionsNamed(source, 'executeMemoryWrite');
  if (functions.length === 0) {
    localFailures.push('MISSING_TARGET: executeMemoryWrite was not found.');
    return { ok: false, failures: localFailures };
  }
  if (functions.length > 1) {
    localFailures.push('AMBIGUOUS_TARGET: executeMemoryWrite was found more than once.');
    return { ok: false, failures: localFailures };
  }
  const [target] = functions;
  // REV9-001: reject generator targets before any body walk or stage accounting.
  if (isGeneratorTarget(target)) {
    localFailures.push(
      'UNSUPPORTED_CONTROL_FLOW: generator executeMemoryWrite target is forbidden.',
    );
    return { ok: false, failures: localFailures };
  }
  rejectUnsupportedControlFlow(target, localFailures);
  rejectIndirectSecurityReferences(source, target, localFailures);
  rejectNestedStageBoundaries(source, target, localFailures);
  for (const parameter of target.parameters ?? []) {
    if (parameter.initializer === undefined) continue;
    rejectSecurityStagesInExpressionContainers(source, parameter.initializer, localFailures);
    const stages = [];
    findStageCallsDeep(source, parameter.initializer, stages, true);
    if (stages.length > 0)
      localFailures.push(
        'AMBIGUOUS_CONTROL_FLOW: security stages inside default parameter initializers are forbidden.',
      );
  }
  const calls = collectDirectCalls(source, target);
  if (calls === null) {
    localFailures.push('UNANALYZABLE: executeMemoryWrite body could not be analysed.');
    return { ok: false, failures: localFailures };
  }

  for (const call of calls)
    if (call.name.includes('[') || (ts.isCallExpression && false)) {
      /* computed targets are rejected via callName returning null for non identifier/property */
    }

  const dynamicCalls = [];
  const visitDynamic = (node, nested) => {
    if (
      nested === false &&
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)) &&
      node !== target
    ) {
      ts.forEachChild(node, (child) => visitDynamic(child, true));
      return;
    }
    if (
      nested === false &&
      ts.isCallExpression(node) &&
      !ts.isPropertyAccessExpression(node.expression) &&
      !ts.isIdentifier(node.expression)
    )
      dynamicCalls.push(node);
    ts.forEachChild(node, (child) => visitDynamic(child, nested));
  };
  if (target.body && ts.isBlock(target.body))
    for (const statement of target.body.statements) visitDynamic(statement, false);
  if (dynamicCalls.length > 0)
    localFailures.push('AMBIGUOUS_CONTROL_FLOW: dynamic/computed call targets are forbidden.');

  const straightLineStages = analyzeStraightLineBody(source, target, localFailures);

  const stagePositions = new Map();
  let writeCount = 0;
  for (const entry of straightLineStages) {
    if (entry.stage === 'memory-write') writeCount += 1;
    if (!stagePositions.has(entry.stage)) stagePositions.set(entry.stage, entry.position);
  }
  if (writeCount > 1)
    localFailures.push('AMBIGUOUS_CONTROL_FLOW: multiple memory-write calls are forbidden.');

  for (const stage of REQUIRED_ORDER)
    if (!stagePositions.has(stage))
      localFailures.push(`MISSING_STAGE: ${stage} is absent from executeMemoryWrite.`);

  for (let index = 1; index < REQUIRED_ORDER.length; index += 1) {
    const previous = REQUIRED_ORDER[index - 1];
    const current = REQUIRED_ORDER[index];
    const previousPosition = stagePositions.get(previous);
    const currentPosition = stagePositions.get(current);
    if (
      previousPosition !== undefined &&
      currentPosition !== undefined &&
      previousPosition > currentPosition
    )
      localFailures.push(`ORDER_VIOLATION: ${previous} must run before ${current}.`);
  }

  const writePosition = stagePositions.get('memory-write');
  if (writePosition !== undefined) {
    for (const stage of [
      'input-normalization',
      'trusted-clock',
      'untrusted-marking',
      'text-scan',
      'metadata-scan',
      'namespace-authorization',
      'memory-policy',
      'approval-validation',
      'approval-consumption',
    ]) {
      const position = stagePositions.get(stage);
      if (position !== undefined && position > writePosition)
        localFailures.push(`ORDER_VIOLATION: ${stage} must run before memory-write.`);
    }
  }
  const auditPosition = stagePositions.get('safe-audit');
  if (writePosition !== undefined && auditPosition !== undefined && auditPosition < writePosition)
    localFailures.push('ORDER_VIOLATION: safe-audit must run after memory-write.');

  return { ok: localFailures.length === 0, failures: localFailures, calls };
}

const interfaceMembers = (source, interfaceName) => {
  let members = null;
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) members = node.members;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return members;
};

const parameterTypes = (source, interfaceName, methodName) => {
  const members = interfaceMembers(source, interfaceName);
  if (members === null) {
    failures.push(`MISSING_CONTRACT: interface ${interfaceName} not found.`);
    return null;
  }
  const method = members.find(
    (member) => ts.isMethodSignature(member) && member.name.getText(source) === methodName,
  );
  if (!method) {
    failures.push(`MISSING_CONTRACT: ${interfaceName}.${methodName} not found.`);
    return null;
  }
  return method.parameters.map((parameter) => parameter.type?.getText(source) ?? 'unknown');
};

const expectParameters = (source, interfaceName, methodName, expected) => {
  const actual = parameterTypes(source, interfaceName, methodName);
  if (actual === null) return;
  for (const [index, type] of expected.entries())
    if (actual[index] !== type)
      failures.push(
        `CONTRACT_MISMATCH: ${interfaceName}.${methodName} parameter ${String(index)} is ` +
          `${actual[index] ?? 'absent'}, expected ${type}.`,
      );
};

const servicePath = join(repoRoot, 'src/core/application/memory-write.service.ts');
const isCli =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isCli) {
  const serviceText = existsSync(servicePath) ? readFileSync(servicePath, 'utf8') : null;
  if (serviceText === null) failures.push(`ZERO_FILES: ${servicePath} is missing.`);
  else {
    const analysis = analyzeExecuteMemoryWrite(serviceText, servicePath);
    for (const failure of analysis.failures) failures.push(failure);
  }

  const memoryPort = parse(join(repoRoot, 'src/core/ports/memory.port.ts'));
  if (memoryPort !== null) {
    expectParameters(memoryPort, 'MemoryPort', 'write', [
      'VerifiedMemoryWrite',
      'AuthenticatedMemoryAccessContext',
    ]);
    expectParameters(memoryPort, 'MemoryPort', 'delete', [
      'MemoryDeleteRequest',
      'AuthenticatedMemoryAccessContext',
    ]);
    expectParameters(memoryPort, 'MemoryPort', 'query', [
      'MemoryQueryRequest',
      'AuthenticatedMemoryAccessContext',
    ]);
    expectParameters(memoryPort, 'MemoryPort', 'read', [
      'MemoryReadRequest',
      'AuthenticatedMemoryAccessContext',
    ]);
  }

  const auditPort = parse(join(repoRoot, 'src/core/ports/memory-audit.port.ts'));
  if (auditPort !== null)
    expectParameters(auditPort, 'MemoryAuditPort', 'record', [
      'SafeMemoryAuditEvent',
      'AuthenticatedMemoryAccessContext',
    ]);

  const mediaAuditPort = parse(join(repoRoot, 'src/core/ports/media-audit-log.port.ts'));
  if (mediaAuditPort !== null)
    expectParameters(mediaAuditPort, 'MediaAuditLogPort', 'record', [
      'SafeMediaAuditEvent',
      'OperationContext',
    ]);

  const policy = parse(join(repoRoot, 'src/core/policy/namespace-isolation.ts'));
  if (policy !== null) {
    const exported = [];
    const visit = (node) => {
      if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
        const isExported =
          node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
          true;
        if (isExported && ts.isFunctionDeclaration(node) && node.name)
          exported.push(node.name.text);
        if (isExported && ts.isVariableStatement(node))
          for (const declaration of node.declarationList.declarations)
            exported.push(declaration.name.getText(policy));
      }
      ts.forEachChild(node, visit);
    };
    visit(policy);
    if (!exported.includes('authorizeMemoryAccess'))
      failures.push('MISSING_CONTRACT: authorizeMemoryAccess is not exported.');
    if (!policy.text.includes('MISSING_ACCESS_CONTEXT'))
      failures.push('MISSING_GUARD: default deny for a missing access context is absent.');
  }

  const pipeline = join(repoRoot, 'src/core/pipelines/memory-write.pipeline.md');
  if (!existsSync(pipeline)) failures.push(`ZERO_FILES: ${pipeline} is missing.`);
  else {
    const text = readFileSync(pipeline, 'utf8');
    const scannerIndex = text.indexOf('SensitiveDataScanner');
    const writeIndex = text.indexOf('MemoryPort');
    if (scannerIndex < 0 || writeIndex < 0 || scannerIndex >= writeIndex)
      failures.push('DOC_ORDER: the documented pipeline must scan before writing.');
    if (!text.includes('trusted') && !text.includes('derive'))
      failures.push('DOC_ORDER: approval demand derivation / trusted clock must be documented.');
  }

  /** Mutation self-tests: fixtures prove the checker fails closed. */
  const runMutation = (name, sourceText, expectedCode) => {
    const analysis = analyzeExecuteMemoryWrite(sourceText, `${name}.ts`);
    if (analysis.ok || !analysis.failures.some((failure) => failure.includes(expectedCode)))
      failures.push(
        `MUTATION_MISS: ${name} should fail with ${expectedCode}, got: ${analysis.failures.join(' | ') || 'ok'}`,
      );
  };

  const correctBody = `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  const policyResult = await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}
`;

  runMutation(
    'dead-helper',
    `
function helper(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  deps.scanner.scanText(command.rawContent, access.operation);
  deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  validateApproval(null, {}, new Date());
  deps.approvals.consume('id', 'nonce', access.operation);
  deps.memory.write({}, access);
  deps.audit.record({}, access);
}
export async function executeMemoryWrite(deps) {
  await deps.memory.write({}, {});
}
`,
    'MISSING_STAGE',
  );

  runMutation(
    'scanner-after-write',
    correctBody
      .replace(
        'await deps.scanner.scanText(command.rawContent, access.operation);\n  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);',
        '',
      )
      .replace(
        'await deps.memory.write({}, access);',
        'await deps.memory.write({}, access);\n  await deps.scanner.scanText(command.rawContent, access.operation);\n  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);',
      ),
    'ORDER_VIOLATION',
  );

  runMutation(
    'audit-before-write',
    correctBody.replace(
      'await deps.memory.write({}, access);\n  await deps.audit.record({}, access);',
      'await deps.audit.record({}, access);\n  await deps.memory.write({}, access);',
    ),
    'ORDER_VIOLATION',
  );

  runMutation(
    'missing-authorization',
    correctBody.replace(
      "authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });\n  ",
      '',
    ),
    'MISSING_STAGE',
  );

  runMutation(
    'approval-after-write',
    correctBody.replace(
      `deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
  await deps.memory.write({}, access);`,
      `await deps.memory.write({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }`,
    ),
    'ORDER_VIOLATION',
  );

  runMutation(
    'false-approval-gate',
    correctBody.replace("if (policyResult.value.decision === 'approval-required')", 'if (false)'),
    'AMBIGUOUS_CONTROL_FLOW',
  );

  runMutation(
    'unrelated-approval-condition',
    correctBody.replace(
      "if (policyResult.value.decision === 'approval-required')",
      'if (command.skipApproval)',
    ),
    'AMBIGUOUS_CONTROL_FLOW',
  );

  runMutation(
    'missing-function',
    `export async function other() { await deps.memory.write({}, {}); }`,
    'MISSING_TARGET',
  );

  runMutation(
    'ambiguous-target',
    `
export async function executeMemoryWrite() { validateOperationContext({}); }
export async function executeMemoryWrite() { validateOperationContext({}); }
`,
    'AMBIGUOUS_TARGET',
  );

  runMutation(
    'comment-not-stage',
    `
export async function executeMemoryWrite(deps, access, command) {
  // validateOperationContext authorizeMemoryAccess deps.scanner.scanText
  const note = "deps.memory.write";
  await deps.memory.write({}, access);
}
`,
    'MISSING_STAGE',
  );

  runMutation(
    'if-else-split',
    `
export async function executeMemoryWrite(deps, access, command) {
  if (false) {
    validateOperationContext(access.operation);
    readTrustedTimestamp(deps.clock);
    normalizeMemoryWriteContent(command.rawContent);
    markUntrusted(command.rawContent);
    await deps.scanner.scanText(command.rawContent, access.operation);
    await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
    classifyData('owner');
    authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
    await deps.policy.evaluate({}, access);
    deriveMemoryWriteApprovalDemand({});
    validateApproval(null, {}, new Date());
    await deps.approvals.consume('id', 'nonce', access.operation);
    await deps.memory.write({}, access);
    await deps.audit.record({}, access);
  } else {
    await deps.memory.write({}, access);
  }
}
`,
    'AMBIGUOUS_CONTROL_FLOW',
  );

  runMutation(
    'missing-normalization',
    correctBody.replace('normalizeMemoryWriteContent(command.rawContent);\n  ', ''),
    'MISSING_STAGE',
  );

  runMutation(
    'missing-untrusted-marking',
    correctBody.replace('markUntrusted(command.rawContent);\n  ', ''),
    'MISSING_STAGE',
  );

  runMutation(
    'stage-in-loop',
    `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  for (const _ of [1]) {
    await deps.scanner.scanText(command.rawContent, access.operation);
  }
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  validateApproval(null, {}, new Date());
  await deps.approvals.consume('id', 'nonce', access.operation);
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}
`,
    'UNSUPPORTED_CONTROL_FLOW',
  );

  runMutation(
    'labeled-return-then-stages',
    `
export async function executeMemoryWrite(deps, access, command) {
  label: { return { ok: true }; }
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  const policyResult = await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}
`,
    'UNSUPPORTED_CONTROL_FLOW',
  );

  runMutation(
    'try-catch-control-flow',
    `
export async function executeMemoryWrite(deps, access, command) {
  try { const x = 1; } catch (error) { const y = 2; }
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  const policyResult = await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  if (policyResult.value.decision === 'approval-required') {
    if (command.approvalId === null) return err({ code: 'APPROVAL_REQUIRED' });
    const grant = await deps.approvals.lookup(command.approvalId, access.operation);
    if (!grant.ok) return err({ code: 'APPROVAL_UNAVAILABLE' });
    const validated = validateApproval(grant.value, demand, trustedNow);
    if (!validated.ok) return err({ code: 'APPROVAL_INVALID' });
    const consumed = await deps.approvals.consume(validated.value.approvalId, validated.value.nonce, access.operation);
    if (!consumed.ok) return err({ code: 'CONSUMPTION_FAILED' });
  }
  await deps.memory.write({}, access);
  await deps.audit.record({}, access);
}
`,
    'UNSUPPORTED_CONTROL_FLOW',
  );

  runMutation(
    'write-in-callback',
    `
export async function executeMemoryWrite(deps, access, command) {
  validateOperationContext(access.operation);
  readTrustedTimestamp(deps.clock);
  normalizeMemoryWriteContent(command.rawContent);
  markUntrusted(command.rawContent);
  await deps.scanner.scanText(command.rawContent, access.operation);
  await deps.scanner.scanMetadata(command.rawMetadata, access.operation);
  classifyData('owner');
  authorizeMemoryAccess(access, 'write', { ownerId: access.ownerId, namespace: command.targetNamespace });
  await deps.policy.evaluate({}, access);
  deriveMemoryWriteApprovalDemand({});
  validateApproval(null, {}, new Date());
  await deps.approvals.consume('id', 'nonce', access.operation);
  const run = async () => { await deps.memory.write({}, access); };
  await run();
  await deps.audit.record({}, access);
}
`,
    'AMBIGUOUS_CONTROL_FLOW',
  );

  runMutation(
    'async-generator-target',
    correctBody.replace(
      'export async function executeMemoryWrite',
      'export async function* executeMemoryWrite',
    ),
    'UNSUPPORTED_CONTROL_FLOW',
  );

  runMutation(
    'sync-generator-target',
    correctBody
      .replace('export async function executeMemoryWrite', 'export function* executeMemoryWrite')
      .replaceAll('await ', ''),
    'UNSUPPORTED_CONTROL_FLOW',
  );

  const production = analyzeExecuteMemoryWrite(correctBody, 'correct.ts');
  if (!production.ok)
    failures.push(`SELF_TEST_BROKEN: correct fixture failed: ${production.failures.join(' | ')}`);

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(
    'Memory isolation checks passed (target-specific path-aware AST order, port contracts, mutation self-tests).',
  );
}
