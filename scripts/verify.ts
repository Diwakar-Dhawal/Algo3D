import { runJava } from '../src/jvm/interp';
import { buildLayout } from '../src/memory/layout';
import { planMotions } from '../src/three/motion';
import { SAMPLES } from '../src/jvm/samples';
import { runIn } from '../src/lang/index';
import { suggestInputs } from '../src/lang/inputs';
import { CPP_SAMPLES, JS_SAMPLES, PY_SAMPLES } from '../src/lang/samples';

const sample = (id: string) => {
  const found = SAMPLES.find((s) => s.id === id);
  if (!found) throw new Error(`missing sample ${id}`);
  return found.code;
};

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(name: string, code: string) {
  const trace = runJava(code);
  console.log(`\n[${name}]`);
  if (trace.compileError) {
    console.log(`  compile error line ${trace.compileError.line}: ${trace.compileError.message}`);
    return trace;
  }
  if (trace.error) console.log(`  runtime: ${trace.error}`);
  console.log(`  steps=${trace.steps.length} stdout=${JSON.stringify(trace.stdout.slice(0, 80))}`);
  return trace;
}

/* ---------- samples ---------- */

const bubble = run('bubble sort', sample('bubble'));
check('sorted output', bubble.stdout.includes('1 2 3 5 7 9'), bubble.stdout.trim());
check('has array object', bubble.heap.some((o) => o.kind === 'array' && o.cells.length === 6));
const swapStep = bubble.steps.find((s) => s.kind === 'write' && s.effects.length > 0);
check('array writes produce effects', !!swapStep, 'no write step with effects');
check('effects carry previous value', !!swapStep?.effects[0]?.prev, JSON.stringify(swapStep?.effects[0]));
check('frames have locals', (bubble.steps[3]?.stack[0]?.vars.length ?? 0) > 0);

const fib = run('fib recursion', sample('fib'));
check('fib value', fib.stdout.trim() === 'fib(6) = 8', fib.stdout.trim());
const deepest = Math.max(...fib.steps.map((s) => s.stack.length));
check('call stack grows with recursion', deepest >= 4, `max depth ${deepest}`);
check('return steps recorded', fib.steps.some((s) => s.kind === 'return'));

const list = run('linked list', sample('list'));
check('prints nodes', list.stdout.trim() === '40\n30\n20\n10', JSON.stringify(list.stdout));
check('heap has 4 nodes', list.heap.filter((o) => o.kind === 'object' && o.label === 'Node').length === 4);
check('reference fields serialised', !!list.heap.find((o) => o.kind === 'object' && o.fields?.some((f) => f.name === 'next')));

const matrix = run('2d array', sample('matrix'));
check('matrix sum', matrix.stdout.trim() === 'sum = 60', matrix.stdout.trim());
check('nested arrays on heap', matrix.heap.filter((o) => o.kind === 'array').length >= 4);

const stack = run('stack class', sample('stack'));
check('stack pop', stack.stdout.trim() === 'popped 5', stack.stdout.trim());
check(
  'instance fields visible on heap',
  stack.heap.some((o) => o.kind === 'object' && (o.fields ?? []).some((f) => f.name === 'top')),
  JSON.stringify(stack.heap.find((o) => o.kind === 'object'))
);
check('this binding recorded', stack.steps.some((s) => s.stack.some((f) => f.thisRef)));

const alist = run('arraylist', sample('arraylist'));
check('arraylist total', alist.stdout.trim() === 'total = 15', alist.stdout.trim());

/* ---------- structure rendering ---------- */

const listLayout = buildLayout(list.steps[Math.floor(list.steps.length * 0.75)], 720, 620);
check('linked nodes chained with arrows', listLayout.edges.some((e) => e.arrow), `${listLayout.edges.length} edges`);
check('chain nodes rendered as nodes', listLayout.nodes.filter((n) => n.objId > 1).length >= 2, `${listLayout.nodes.length} nodes`);
check('all locals in stack trace', listLayout.frames.some((f) => f.vars.length >= 2), JSON.stringify(listLayout.frames.map((f) => f.vars.length)));

const tree = run('binary tree', sample('tree'));
check('inorder output', tree.stdout.trim() === '20 30 40 50 70', tree.stdout.trim());
const treeLayout = buildLayout(tree.steps[Math.floor(tree.steps.length * 0.8)], 720, 620);
check('tree edges drawn', treeLayout.edges.length >= 3, `${treeLayout.edges.length} edges`);
check('tree nodes rendered', treeLayout.nodes.length >= 4, `${treeLayout.nodes.length} nodes`);

/* ---------- motion planning ---------- */

const swapPlan = planMotions(
  [{ id: 'a', pos: [0, 0, 0] }, { id: 'b', pos: [1.6, 0, 0] }],
  [{ id: 'a', pos: [1.6, 0, 0] }, { id: 'b', pos: [0, 0, 0] }],
  [0, 1.5, 0]
);
check(
  'swapped blocks arc in opposite directions',
  !!swapPlan.motions.get('a')?.arc && !!swapPlan.motions.get('b')?.arc,
  JSON.stringify([...swapPlan.motions])
);

const insertPlan = planMotions(
  [{ id: 'a', pos: [0, 0, 0] }],
  [{ id: 'a', pos: [0, 0, 0] }, { id: 'b', pos: [1.6, 0, 0] }],
  [0, 1.5, 0]
);
check(
  'inserted block starts apart and is marked entering',
  !!insertPlan.motions.get('b')?.entering && insertPlan.motions.get('b')!.from[1] === 1.5,
  JSON.stringify(insertPlan.motions.get('b'))
);

const deletePlan = planMotions(
  [{ id: 'a', pos: [0, 0, 0] }, { id: 'b', pos: [1.6, 0, 0] }, { id: 'c', pos: [3.2, 0, 0] }],
  [{ id: 'a', pos: [0, 0, 0] }, { id: 'c', pos: [1.6, 0, 0] }],
  [0, 1.5, 0]
);
check('deleted block is handed back as a ghost', deletePlan.removed.length === 1 && deletePlan.removed[0].id === 'b', JSON.stringify(deletePlan.removed));
check('remaining blocks glide over the gap', !deletePlan.motions.get('c')?.arc && deletePlan.motions.get('c')!.from[0] === 3.2, JSON.stringify(deletePlan.motions.get('c')));

/* ---------- extra language coverage ---------- */

const misc = run(
  'loops, strings, ternary',
  `class Main {
    public static void main(String[] args) {
        int sum = 0;
        for (int i = 1; i <= 5; i++) { sum += i; }
        String label = sum > 10 ? "big" : "small";
        int j = 0;
        while (j < 3) { j++; }
        System.out.println(label + " " + sum + " " + j);
        System.out.println("len " + label.length() + " " + Math.max(2, 7));
    }
}`
);
check('arithmetic + ternary + while', misc.stdout.split('\n')[0] === 'big 15 3', JSON.stringify(misc.stdout));

const oob = run(
  'out of bounds',
  `class Main {
    public static void main(String[] args) {
        int[] a = new int[3];
        a[5] = 1;
    }
}`
);
check('bounds error reported', (oob.error ?? '').includes('ArrayIndexOutOfBounds'), oob.error ?? 'no error');

const npe = run(
  'null pointer',
  `class Main {
    public static void main(String[] args) {
        int[] a = null;
        System.out.println(a.length);
    }
}`
);
check('null pointer reported', (npe.error ?? '').includes('NullPointer'), npe.error ?? 'no error');

const compileErr = run(
  'syntax error',
  `class Main {
    public static void main(String[] args) {
        int x = ;
    }
}`
);
check('compile error has line', !!compileErr.compileError && compileErr.compileError.line > 0, JSON.stringify(compileErr.compileError));

/* ---------- multiple languages ---------- */

function runLang(language: 'java' | 'python' | 'js' | 'cpp', name: string, code: string) {
  const trace = runIn(language, code);
  console.log(`\n[${language}: ${name}]`);
  if (trace.compileError) {
    console.log(`  translate/compile error line ${trace.compileError.line}: ${trace.compileError.message}`);
    if (!translated) console.log('  (generated code follows)');
  }
  if (trace.error) console.log(`  runtime: ${trace.error}`);
  console.log(`  steps=${trace.steps.length} stdout=${JSON.stringify(trace.stdout.slice(0, 90))}`);
  return trace;
}

let translated = false;

const sampleOf = (list: { id: string; code: string }[], id: string) => list.find((s) => s.id === id)?.code ?? '';

const pyBubble = runLang('python', 'bubble', sampleOf(PY_SAMPLES, 'py-bubble'));
check('python bubble sorts', pyBubble.stdout.includes('[1, 2, 3, 5, 7, 9]'), pyBubble.stdout.trim());
check('python trace has steps', pyBubble.steps.length > 20, `${pyBubble.steps.length}`);
const pyBubbleLines = sampleOf(PY_SAMPLES, 'py-bubble').split('\n').length;
check(
  'python step lines point at real source lines',
  pyBubble.steps.every((s) => s.line >= 1 && s.line <= pyBubbleLines),
  JSON.stringify(pyBubble.steps.map((s) => s.line).filter((l) => l < 1 || l > pyBubbleLines))
);

const pyFib = runLang('python', 'fib', sampleOf(PY_SAMPLES, 'py-fib'));
check('python fib', pyFib.stdout.trim() === 'fib(6) = 8', pyFib.stdout.trim());

const pyBinary = runLang('python', 'binary search', sampleOf(PY_SAMPLES, 'py-binary'));
check('python binary search', pyBinary.stdout.trim() === 'found at 4', pyBinary.stdout.trim());

const pyStack = runLang('python', 'stack', sampleOf(PY_SAMPLES, 'py-stack'));
check('python append/pop/len', pyStack.stdout.trim() === 'popped 5 left 2', pyStack.stdout.trim());

const jsBubble = runLang('js', 'bubble', sampleOf(JS_SAMPLES, 'js-bubble'));
check('js bubble sorts', jsBubble.stdout.includes('[1, 2, 3, 5, 7, 9]'), jsBubble.stdout.trim());

translated = true;
const jsFib = runLang('js', 'fib', sampleOf(JS_SAMPLES, 'js-fib'));
check('js fib', jsFib.stdout.trim() === 'fib(6) = 8', jsFib.stdout.trim());

const jsPair = runLang('js', 'two pointers', sampleOf(JS_SAMPLES, 'js-pair'));
check('js two pointers', jsPair.stdout.trim() === 'pair: [0, 1]', jsPair.stdout.trim());

const jsStack = runLang('js', 'stack', sampleOf(JS_SAMPLES, 'js-stack'));
check('js push/pop/length', jsStack.stdout.trim() === 'popped 5 left 2', jsStack.stdout.trim());

const cppBubble = runLang('cpp', 'bubble', sampleOf(CPP_SAMPLES, 'cpp-bubble'));
check('cpp bubble sorts', cppBubble.stdout.replace(/\s+/g, ' ').trim() === 'sorted: 1 2 3 5 7 9', JSON.stringify(cppBubble.stdout));

const cppFib = runLang('cpp', 'fib', sampleOf(CPP_SAMPLES, 'cpp-fib'));
check('cpp fib', cppFib.stdout.trim() === 'fib(6) = 8', cppFib.stdout.trim());

const cppList = runLang('cpp', 'linked list', sampleOf(CPP_SAMPLES, 'cpp-list'));
check('cpp struct linked list', cppList.stdout.replace(/\s+/g, ' ').trim() === '40 30 20 10', JSON.stringify(cppList.stdout));
check('cpp list nodes on heap', cppList.heap.filter((o) => o.kind === 'object').length === 4, JSON.stringify(cppList.heap.map((o) => o.label)));

/* ---------- leetcode-style python ---------- */

const LEETCODE_FN = [
  'class Solution:',
  '    def removeDuplicates(self, nums: list[int]) -> int:',
  '        if not nums:',
  '            return 0',
  '',
  '        write = 1',
  '        for read in range(1, len(nums)):',
  '            if nums[read] != nums[write - 1]:',
  '                nums[write] = nums[read]',
  '                write += 1',
  '',
  '        return write',
].join('\n');

const onlyDefs = runLang('python', 'class wrapper, no call', LEETCODE_FN);
check(
  'class wrapper is unwrapped and asks for a call',
  (onlyDefs.compileError?.message ?? '').includes('nothing calls it'),
  JSON.stringify(onlyDefs.compileError)
);

const solved = runLang(
  'python',
  'class wrapper + driver',
  `${LEETCODE_FN}\n\nnums = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4]\nk = removeDuplicates(nums)\nprint("k =", k)\nprint(nums)`
);
check('leetcode solution returns 5', solved.stdout.includes('k = 5'), JSON.stringify(solved.stdout));
check('in-place compaction visible', solved.stdout.includes('[0, 1, 2, 3, 4'), JSON.stringify(solved.stdout));

const emptyInput = runLang('python', 'empty list guard', `${LEETCODE_FN}\n\nresult = removeDuplicates([])\nprint(result)`);
check('empty list guard returns 0', emptyInput.stdout.trim() === '0', JSON.stringify(emptyInput.stdout));

/* ---------- inputs for every language ---------- */

const pasted = runIn('python', LEETCODE_FN, 'nums = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4]\ncall removeDuplicates(nums)');
check('python inputs run a pasted solution', pasted.stdout.includes('-> 5'), JSON.stringify(pasted.stdout));
check('python inputs show the mutated array', pasted.stdout.includes('[0, 1, 2, 3, 4'), JSON.stringify(pasted.stdout));
check(
  'injected python lines map back to the file',
  pasted.steps.every((s) => s.line >= 1 && s.line <= LEETCODE_FN.split('\n').length),
  JSON.stringify([...new Set(pasted.steps.map((s) => s.line))])
);

const pyScript = runIn('python', sampleOf(PY_SAMPLES, 'py-bubble'), 'values = [3, 1, 2]');
check('python input replaces the literal', pyScript.stdout.includes('[1, 2, 3]'), pyScript.stdout.trim());

const jsScript = runIn('js', sampleOf(JS_SAMPLES, 'js-bubble'), 'values = [3, 1, 2]');
check('js input replaces the literal', jsScript.stdout.includes('[1, 2, 3]'), jsScript.stdout.trim());

const cppScript = runIn('cpp', sampleOf(CPP_SAMPLES, 'cpp-bubble'), 'values = [3, 1, 2]');
check('cpp input replaces the literal', cppScript.stdout.replace(/\s+/g, ' ').trim() === 'sorted: 1 2 3', JSON.stringify(cppScript.stdout));

const javaSource = sample('bubble');
const javaScript = runIn('java', javaSource, 'a = [3, 1, 2]');
check('java input replaces the array literal', javaScript.stdout.includes('1 2 3'), javaScript.stdout.trim());
check(
  'replaced java keeps its line numbers',
  javaScript.steps.every((s) => s.line >= 1 && s.line <= javaSource.split('\n').length),
  JSON.stringify([...new Set(javaScript.steps.map((s) => s.line))])
);

const javaExtra = runIn('java', javaSource, 'extra = 7\ncall bubbleSort(a)');
check('java extra values and a call compile', !javaExtra.compileError && !javaExtra.error, JSON.stringify(javaExtra.compileError ?? javaExtra.error));

const pySuggestion = suggestInputs('python', LEETCODE_FN);
check('suggestion finds a pasted method and its parameter', pySuggestion.call === 'removeDuplicates(nums)', JSON.stringify(pySuggestion));
check('suggestion offers a value for the parameter', pySuggestion.values.some((v) => v.name === 'nums'), JSON.stringify(pySuggestion.values));

const javaSuggestion = suggestInputs('java', sample('bubble'));
check('suggestion reads the java sample inputs', JSON.stringify(javaSuggestion.values.map((v) => v.name)) === '["a"]', JSON.stringify(javaSuggestion.values));

const badInput = runIn('python', sampleOf(PY_SAMPLES, 'py-bubble'), 'values =');
check('empty value names the line', (badInput.compileError?.message ?? '').includes('Give values a value'), JSON.stringify(badInput.compileError));

const pyExpr = runIn('python', sampleOf(PY_SAMPLES, 'py-bubble'), 'values = [1 + 2, 4 - 3, 2]');
check('python accepts an expression as the value', pyExpr.stdout.includes('[1, 2, 3]'), pyExpr.stdout.trim());

const javaExpr = runIn('java', sampleOf(SAMPLES, 'bubble'), 'a = new int[]{3, 1, 2}');
check('java accepts an expression as the value', javaExpr.stdout.includes('1 2 3'), javaExpr.stdout.trim());

/* ---------- loops behave the same in every language ---------- */

const pyForArray = runIn(
  'python',
  ['def total(a):', '    s = 0', '    for x in a:', '        s += x', '    return s', '', 'nums = [4, 5, 6]', 'print(total(nums))'].join('\n')
);
check('python for-in over an array', pyForArray.stdout.trim() === '15', JSON.stringify(pyForArray.stdout));

const pyForList = runIn(
  'python',
  ['items = []', 'items.append(4)', 'items.append(6)', 'sum = 0', 'for x in items:', '    sum += x', 'print(sum)'].join('\n')
);
check('python for-in over a list', pyForList.stdout.trim() === '10', JSON.stringify(pyForList.stdout));

const jsForOf = runIn(
  'js',
  ['function total(a) {', '  let s = 0;', '  for (const x of a) { s += x; }', '  return s;', '}', '', 'const nums = [4, 5, 6];', 'console.log(total(nums));'].join('\n')
);
check('js for-of over an array', jsForOf.stdout.trim() === '15', JSON.stringify(jsForOf.stdout));

const jsForOfList = runIn(
  'js',
  ['const items = [];', 'items.push(4);', 'items.push(6);', 'let s = 0;', 'for (const x of items) { s += x; }', 'console.log(s);'].join('\n')
);
check('js for-of over a list', jsForOfList.stdout.trim() === '10', JSON.stringify(jsForOfList.stdout));

const cppRangeFor = runIn(
  'cpp',
  [
    '#include <iostream>',
    '#include <vector>',
    'using namespace std;',
    'int total(vector<int>& a) {',
    '    int s = 0;',
    '    for (int x : a) { s += x; }',
    '    return s;',
    '}',
    'int main() {',
    '    vector<int> nums = {4, 5, 6};',
    '    cout << total(nums) << endl;',
    '    return 0;',
    '}',
  ].join('\n')
);
check('cpp range-for', cppRangeFor.stdout.trim() === '15', JSON.stringify(cppRangeFor.stdout));

const pyPrelude = runIn('python', sampleOf(PY_SAMPLES, 'py-bubble'), 'pad = 3\nvalues = [3, 1, 2]');
check('extra python values still run the script', pyPrelude.stdout.includes('[1, 2, 3]'), pyPrelude.stdout.trim());
check(
  'prepended python values keep line numbers in range',
  pyPrelude.steps.every((s) => s.line >= 1 && s.line <= sampleOf(PY_SAMPLES, 'py-bubble').split('\n').length),
  JSON.stringify([...new Set(pyPrelude.steps.map((s) => s.line))])
);

const jsPrelude = runIn('js', sampleOf(JS_SAMPLES, 'js-bubble'), 'pad = 3\nvalues = [3, 1, 2]');
check('extra js values still run the script', jsPrelude.stdout.includes('[1, 2, 3]'), JSON.stringify(jsPrelude.stdout));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
