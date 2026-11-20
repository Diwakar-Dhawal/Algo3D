import { runJava } from '../src/jvm/interp';
import { buildLayout } from '../src/memory/layout';
import { planMotions } from '../src/three/motion';
import { stableIds, type IdStore } from '../src/three/identity';
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

/* ---------- java as it is actually written ---------- */

const javaPasted = runIn(
  'java',
  [
    'import java.util.*;',
    '',
    'public class Main {',
    '    public static void main(String... args) {',
    '        int[] a = {3, 1, 2};',
    '        int sum = 0;',
    '        for (int v : a) sum += v;',
    '        System.out.println("sum = " + sum);',
    '    }',
    '}',
  ].join('\n')
);
check('imports, public class, varargs and for-each all run', javaPasted.stdout.trim() === 'sum = 6', JSON.stringify(javaPasted.compileError ?? javaPasted.error ?? javaPasted.stdout));

const javaForEachList = runIn(
  'java',
  [
    'import java.util.ArrayList;',
    '',
    'class Main {',
    '    public static void main(String[] args) {',
    '        ArrayList<Integer> xs = new ArrayList<>();',
    '        xs.add(4);',
    '        xs.add(6);',
    '        int total = 0;',
    '        for (int x : xs) total += x;',
    '        System.out.println(total);',
    '    }',
    '}',
  ].join('\n')
);
check('for-each walks an ArrayList', javaForEachList.stdout.trim() === '10', JSON.stringify(javaForEachList.compileError ?? javaForEachList.error ?? javaForEachList.stdout));

const javaAnnotated = runIn(
  'java',
  ['@SuppressWarnings("unchecked")', 'public final class Main {', '    public static void main(String[] args) {', '        System.out.println("ok");', '    }', '}'].join('\n')
);
check('class annotations are ignored', javaAnnotated.stdout.trim() === 'ok', JSON.stringify(javaAnnotated.compileError ?? javaAnnotated.error ?? javaAnnotated.stdout));

const scannerProgram = [
  'import java.util.Scanner;',
  'class Main {',
  '    public static void main(String[] args) {',
  '        Scanner in = new Scanner(System.in);',
  '        int n = in.nextInt();',
  '        int total = 0;',
  '        for (int i = 0; i < n; i++) total += in.nextInt();',
  '        String rest = in.nextLine();',
  '        double half = in.nextDouble();',
  '        System.out.println("total=" + total + " rest=[" + rest + "] half=" + half);',
  '    }',
  '}',
].join('\n');

const javaScanner = runIn('java', scannerProgram, '', '3 4 8 1\n7.5');
check(
  'Scanner reads ints, the rest of a line and a double',
  javaScanner.stdout.trim() === 'total=13 rest=[] half=7.5',
  JSON.stringify(javaScanner.compileError ?? javaScanner.error ?? javaScanner.stdout)
);

const javaScannerEmpty = runIn('java', scannerProgram, '', '');
check(
  'Scanner on empty input reports NoSuchElementException',
  (javaScannerEmpty.error ?? '').includes('NoSuchElementException'),
  JSON.stringify(javaScannerEmpty.error)
);

const javaScannerBad = runIn('java', scannerProgram, '', 'three 4 8');
check(
  'Scanner on a non-number reports InputMismatchException',
  (javaScannerBad.error ?? '').includes('InputMismatchException'),
  JSON.stringify(javaScannerBad.error)
);

const javaScannerLoop = runIn(
  'java',
  [
    'import java.util.Scanner;',
    'class Main {',
    '    public static void main(String[] args) {',
    '        Scanner in = new Scanner(System.in);',
    '        int total = 0;',
    '        while (in.hasNextInt()) total += in.nextInt();',
    '        System.out.println(total);',
    '    }',
    '}',
  ].join('\n'),
  '',
  '2 3 4 5'
);
check(
  'hasNextInt ends the read loop',
  javaScannerLoop.stdout.trim() === '14',
  JSON.stringify(javaScannerLoop.compileError ?? javaScannerLoop.error ?? javaScannerLoop.stdout)
);

check('for-each records the loop variable as a step', javaPasted.steps.some((s) => s.note.includes('v = ')), `${javaPasted.steps.length} steps`);

/* ---------- lambdas, streams, maps and sets ---------- */

const javaMain = (body: string) =>
  [
    'import java.util.*;',
    'import java.util.stream.*;',
    'public class Main {',
    '    public static void main(String[] args) {',
    body,
    '    }',
    '}',
  ].join('\n');

const streamArr = runIn('java', javaMain('        int[] a = {1, 2, 3, 4, 5};\n        int[] even = Arrays.stream(a).filter(x -> x % 2 == 0).map(x -> x * x).toArray();\n        System.out.println(Arrays.toString(even));'));
check('stream filter + map + toArray', streamArr.stdout.includes('[4, 16]'), JSON.stringify(streamArr.compileError ?? streamArr.error ?? streamArr.stdout));

const streamList = runIn('java', javaMain('        List<Integer> xs = Arrays.asList(5, 3, 8, 1);\n        List<Integer> out = xs.stream().filter(x -> x > 2).sorted().collect(Collectors.toList());\n        System.out.println(out);'));
check('stream sorted + collect(toList)', streamList.stdout.includes('[3, 5, 8]'), JSON.stringify(streamList.compileError ?? streamList.error ?? streamList.stdout));

const intStream = runIn('java', javaMain('        System.out.println(IntStream.range(1, 5).sum() + " " + IntStream.rangeClosed(1, 5).count());'));
check('IntStream.range/rangeClosed', intStream.stdout.trim() === '10 5', JSON.stringify(intStream.compileError ?? intStream.error ?? intStream.stdout));

const methodRef = runIn('java', javaMain('        List<String> names = Arrays.asList("bob", "ann");\n        names.forEach(System.out::println);'));
check('method reference forEach', methodRef.stdout === 'bob\nann\n', JSON.stringify(methodRef.compileError ?? methodRef.error ?? methodRef.stdout));

const mapBasics = runIn('java', javaMain('        Map<String, Integer> age = new HashMap<>();\n        age.put("ann", 30);\n        age.put("bob", 25);\n        System.out.println(age.get("ann") + " " + age.size() + " " + age.getOrDefault("zed", 0));\n        System.out.println(age);'));
check('map put/get/size/getOrDefault/toString', mapBasics.stdout === '30 2 0\n{ann=30, bob=25}\n', JSON.stringify(mapBasics.compileError ?? mapBasics.error ?? mapBasics.stdout));

const mapStream = runIn('java', javaMain('        Map<String, Integer> age = new HashMap<>();\n        age.put("ann", 30);\n        age.put("bob", 25);\n        System.out.println(age.keySet().stream().mapToInt(k -> age.get(k)).sum());'));
check('keySet().stream() sums through a map', mapStream.stdout.trim() === '55', JSON.stringify(mapStream.compileError ?? mapStream.error ?? mapStream.stdout));

const optMax = runIn('java', javaMain('        int[] a = {3, 9, 4};\n        System.out.println(Arrays.stream(a).max().getAsInt());'));
check('stream max().getAsInt()', optMax.stdout.trim() === '9', JSON.stringify(optMax.compileError ?? optMax.error ?? optMax.stdout));

const joining = runIn('java', javaMain('        List<String> w = Arrays.asList("a", "b", "c");\n        System.out.println(w.stream().collect(Collectors.joining("-")));'));
check('joining with a separator string', joining.stdout.trim() === 'a-b-c', JSON.stringify(joining.compileError ?? joining.error ?? joining.stdout));

const castCheck = runIn('java', javaMain('        double d = 7.9;\n        System.out.println((int) d);'));
check('casts coerce values', castCheck.stdout.trim() === '7', JSON.stringify(castCheck.compileError ?? castCheck.error ?? castCheck.stdout));

const setCheck = runIn('java', javaMain('        Set<Integer> s = new HashSet<>();\n        s.add(1);\n        s.add(1);\n        s.add(2);\n        System.out.println(s.size() + " " + s);'));
check('a Set keeps one of each value', setCheck.stdout.trim() === '2 [1, 2]', JSON.stringify(setCheck.compileError ?? setCheck.error ?? setCheck.stdout));

const literalOps = runIn('java', javaMain('        System.out.println("-");\n        System.out.println("(" + ")");'));
check('string literals that look like operators still print', literalOps.stdout === '-\n()\n', JSON.stringify(literalOps.compileError ?? literalOps.error ?? literalOps.stdout));

const streamsSample = runIn('java', sampleOf(SAMPLES, 'streams'));
check('the streams sample runs', streamsSample.stdout.includes('passing: [72, 90, 65]'), JSON.stringify(streamsSample.compileError ?? streamsSample.error ?? streamsSample.stdout));
check('the streams sample records filter steps', streamsSample.steps.some((s) => s.note.startsWith('filter →')), `${streamsSample.steps.length} steps`);

// block identity: a plain write must not look like delete + insert, and it must
// keep the hand-placed position that is keyed by the block id
const idStore = (): IdStore => ({ current: new Map() });
const store = idStore();
const before = stableIds(store, 'arr', ['5', '2', '9']);
const afterWrite = stableIds(store, 'arr', ['5', '7', '9']);
check('a value written in place keeps its block identity', afterWrite.join() === before.join(), `${before.join()} → ${afterWrite.join()}`);

const tilesOf = (ids: string[]) => ids.map((id, i) => ({ id, pos: [i, 0, 0] as [number, number, number] }));
const writePlan = planMotions(tilesOf(before), tilesOf(afterWrite), [0, -1.5, 0]);
check('a value write animates no removal and no entry', writePlan.removed.length === 0 && !tilesOf(afterWrite).some((t) => writePlan.motions.get(t.id)!.entering), `${writePlan.removed.length} removed`);

const popStore = idStore();
const pushIds = stableIds(popStore, 'list', ['1', '2', '3', '4']);
const popIds = stableIds(popStore, 'list', ['1', '2', '3']);
const popped = pushIds.filter((id) => !popIds.includes(id));
check('a deletion retires exactly one block', popped.length === 1, JSON.stringify(popped));
check('the remaining blocks keep their ids when a value is popped', popIds.join() === pushIds.slice(0, 3).join(), `${pushIds.join()} → ${popIds.join()}`);

const insertStore = idStore();
const baseIds = stableIds(insertStore, 'grow', ['2', '3']);
const grownIds = stableIds(insertStore, 'grow', ['1', '2', '3']);
check('an insertion adds exactly one block', grownIds.filter((id) => !baseIds.includes(id)).length === 1, `${baseIds.join()} → ${grownIds.join()}`);

const swapStore = idStore();
const unsortedIds = stableIds(swapStore, 'swap', ['3', '1', '2']);
const sortedIds = stableIds(swapStore, 'swap', ['1', '3', '2']);
check('a swap keeps both blocks and neither is retired', sortedIds.slice(0, 2).sort().join() === unsortedIds.slice(0, 2).sort().join(), `${unsortedIds.join()} → ${sortedIds.join()}`);

/* ---------- rails that show sequence without reading indexes ---------- */

const arrTrace = runIn('java', javaMain('        int[] a = {4, 8, 15, 16};\n        System.out.println(a.length);'));
const arrLayout = buildLayout(arrTrace.steps[arrTrace.steps.length - 1], 720, 620);
const cellRails = arrLayout.edges.filter((e) => e.key.startsWith('rail-'));
check('array cells are joined by one rail per neighbour pair', cellRails.length === 3, `${cellRails.length} rails`);
check('array rails are plain lines, not arrows', cellRails.every((e) => e.soft && !e.arrow), JSON.stringify(cellRails.map((e) => [e.soft, e.arrow])));
check('every rail endpoint names a rendered block', cellRails.every((e) => arrLayout.nodes.some((n) => n.key === e.from) && arrLayout.nodes.some((n) => n.key === e.to)), JSON.stringify(cellRails.map((e) => [e.from, e.to])));

const gridTrace = runIn('java', javaMain('        int[][] g = {{1, 2, 3}, {4, 5, 6}};\n        System.out.println(g.length);'));
const gridLayout = buildLayout(gridTrace.steps[gridTrace.steps.length - 1], 900, 700);
const rowLinks = gridLayout.edges.filter((e) => e.key.startsWith('row-'));
const gridRails = gridLayout.edges.filter((e) => e.key.startsWith('rail-'));
check('a matrix ties each row to the array that holds it', rowLinks.length === 2, `${rowLinks.length} row links`);
const railsPerObject = new Map<string, number>();
gridRails.forEach((e) => {
  const objId = e.from.split('-')[1];
  railsPerObject.set(objId, (railsPerObject.get(objId) ?? 0) + 1);
});
check('every matrix row is railed end to end', [...railsPerObject.values()].filter((n) => n === 2).length === 2, JSON.stringify([...railsPerObject.entries()]));

/* ---------- Java language coverage ---------- */

const javaOut = (code: string) => {
  const trace = runIn('java', code);
  return {
    out: trace.stdout,
    err: trace.compileError ? `compile L${trace.compileError.line}: ${trace.compileError.message}` : trace.error ?? '',
  };
};
const javaCheck = (name: string, code: string, expected: string) => {
  const r = javaOut(code);
  check(name, !r.err && r.out === expected, r.err || JSON.stringify(r.out));
};
const MAIN = (body: string) => `public class Main {\n    public static void main(String[] args) {\n${body}\n    }\n}`;

javaCheck(
  'switch falls through until break',
  MAIN('        int x = 2;\n        switch (x) {\n            case 1: System.out.println("one"); break;\n            case 2: System.out.println("two");\n            case 3: System.out.println("three"); break;\n            default: System.out.println("other");\n        }'),
  'two\nthree\n'
);
javaCheck(
  'switch arrow arms do not fall through',
  MAIN('        for (int i = 1; i <= 4; i++) {\n            switch (i) {\n                case 1, 3 -> System.out.println(i + " odd");\n                case 2 -> System.out.println(i + " even");\n                default -> System.out.println("big");\n            }\n        }'),
  '1 odd\n2 even\n3 odd\nbig\n'
);
javaCheck(
  'switch expressions with yield',
  MAIN('        int x = 3;\n        String s = switch (x) {\n            case 1 -> "one";\n            case 3 -> { String t = "thr" + "ee"; yield t; }\n            default -> "many";\n        };\n        System.out.println(s);'),
  'three\n'
);
javaCheck(
  'try / catch / finally / throw',
  MAIN('        try {\n            int[] a = {1, 2};\n            System.out.println(a[2]);\n        } catch (ArrayIndexOutOfBoundsException e) {\n            System.out.println("caught: " + e.getMessage());\n        } finally {\n            System.out.println("finally");\n        }\n        try {\n            int z = 10 / 0;\n        } catch (ArithmeticException e) {\n            System.out.println("math: " + e.getMessage());\n        }\n        try {\n            throw new IllegalStateException("boom");\n        } catch (Exception e) {\n            System.out.println(e.getMessage() + " / " + e.toString());\n        }'),
  'caught: Index 2 out of bounds for length 2\nfinally\nmath: / by zero\nboom / IllegalStateException: boom\n'
);
javaCheck(
  'finally runs while an exception propagates',
  'public class Main {\n    static int risky(int n) {\n        try {\n            if (n == 0) return 7;\n            throw new IllegalArgumentException("bad " + n);\n        } finally {\n            System.out.println("cleanup " + n);\n        }\n    }\n    public static void main(String[] args) {\n        System.out.println(risky(0));\n        try {\n            System.out.println(risky(1));\n        } catch (IllegalArgumentException | IllegalStateException e) {\n            System.out.println("outer caught " + e.getMessage());\n        }\n    }\n}',
  'cleanup 0\n7\ncleanup 1\nouter caught bad 1\n'
);
{
  const uncaught = javaOut(MAIN('        throw new IllegalStateException("nope");'));
  check('an uncaught exception ends the trace with its message', uncaught.err.includes('IllegalStateException: nope'), uncaught.err);
}
javaCheck(
  'String.format handles width, precision and hex',
  MAIN('        System.out.println(String.format("%d-%s-%.2f-%05d-%x-%c", 7, "ab", 3.14159, 42, 255, \'z\'));'),
  '7-ab-3.14-00042-ff-z\n'
);
javaCheck(
  'StringBuilder chains, inserts and reverses',
  MAIN('        StringBuilder sb = new StringBuilder();\n        sb.append("ab").append(12).append(\'c\');\n        sb.insert(0, ">");\n        sb.reverse();\n        System.out.println(sb.toString() + " len=" + sb.length());'),
  'c21ba> len=6\n'
);
javaCheck(
  'inheritance: fields, super ctor, super call and override dispatch',
  'class Animal {\n    String name;\n    Animal(String name) { this.name = name; }\n    String speak() { return "..."; }\n    String describe() { return name + " says " + speak(); }\n}\nclass Dog extends Animal {\n    Dog(String name) { super(name); }\n    @Override String speak() { return "woof"; }\n    String both() { return super.speak() + "/" + speak(); }\n}\npublic class Main {\n    public static void main(String[] args) {\n        Dog d = new Dog("rex");\n        System.out.println(d.describe());\n        System.out.println(d.both());\n        System.out.println(d.name);\n    }\n}',
  'rex says woof\n.../woof\nrex\n'
);
javaCheck(
  'instanceof and casts work through the hierarchy',
  'class Shape {}\nclass Circle extends Shape { int r = 2; }\npublic class Main {\n    public static void main(String[] args) {\n        Shape s = new Circle();\n        if (s instanceof Circle) {\n            Circle c = (Circle) s;\n            System.out.println("r=" + c.r);\n        }\n    }\n}',
  'r=2\n'
);
javaCheck(
  'interfaces and abstract classes',
  'abstract class Task {\n    abstract String name();\n    String run() { return "run " + name(); }\n}\ninterface Named {\n    String tag();\n    default String shout() { return tag().toUpperCase(); }\n}\nclass Build extends Task implements Named {\n    String name() { return "build"; }\n    public String tag() { return "b"; }\n}\npublic class Main {\n    public static void main(String[] args) {\n        Build b = new Build();\n        System.out.println(b.run() + " " + b.shout());\n        Named n = b;\n        System.out.println(n.shout());\n    }\n}',
  'run build B\nB\n'
);
javaCheck(
  'enums: name, ordinal, values, valueOf and switch',
  'enum Color { RED, GREEN, BLUE }\npublic class Main {\n    public static void main(String[] args) {\n        Color c = Color.GREEN;\n        System.out.println(c + " " + c.name() + " " + c.ordinal());\n        for (Color k : Color.values()) System.out.print(k + " ");\n        System.out.println();\n        switch (c) {\n            case RED -> System.out.println("red!");\n            case GREEN -> System.out.println("green!");\n            default -> System.out.println("other");\n        }\n        System.out.println(Color.valueOf("BLUE"));\n    }\n}',
  'GREEN GREEN 1\nRED GREEN BLUE \ngreen!\nBLUE\n'
);
javaCheck(
  'records get a constructor and accessors',
  'record Point(int x, int y) {}\npublic class Main {\n    public static void main(String[] args) {\n        Point p = new Point(3, 4);\n        System.out.println(p.x() + "," + p.y() + " -> " + (p.x() + p.y()));\n    }\n}',
  '3,4 -> 7\n'
);
javaCheck(
  'map entrySet with entry getters',
  'import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Map<String, Integer> m = new HashMap<>();\n        m.put("a", 1);\n        m.put("b", 2);\n        for (Map.Entry<String, Integer> e : m.entrySet()) {\n            System.out.println(e.getKey() + "=" + e.getValue());\n        }\n    }\n}',
  'a=1\nb=2\n'
);
javaCheck(
  'flatMap flattens nested lists',
  'import java.util.*;\nimport java.util.stream.*;\npublic class Main {\n    public static void main(String[] args) {\n        List<List<Integer>> xs = new ArrayList<>();\n        xs.add(Arrays.asList(1, 2));\n        xs.add(Arrays.asList(3));\n        System.out.println(xs.stream().flatMap(l -> l.stream()).collect(Collectors.toList()));\n    }\n}',
  '[1, 2, 3]\n'
);
{
  const r = javaOut(
    'import java.util.*;\nimport java.util.stream.*;\npublic class Main {\n    public static void main(String[] args) {\n        List<String> words = Arrays.asList("ann", "bob", "amy", "cat");\n        System.out.println(words.stream().collect(Collectors.groupingBy(w -> w.substring(0, 1))));\n        System.out.println(words.stream().collect(Collectors.toMap(w -> w, w -> w.length())));\n        System.out.println(words.stream().collect(Collectors.partitioningBy(w -> w.length() > 3)).keySet());\n        System.out.println(words.stream().collect(Collectors.averagingInt(w -> w.length())));\n        System.out.println(words.stream().collect(Collectors.joining(", ", "[", "]")));\n    }\n}'
  );
  check('groupingBy groups values by key', r.out.includes('{a=[ann, amy], b=[bob], c=[cat]}'), r.err || r.out);
  check('toMap builds key/value pairs', r.out.includes('{ann=3, bob=3, amy=3, cat=3}'), r.err || r.out);
  check('partitioningBy splits true/false', r.out.includes('[true, false]'), r.err || r.out);
  check('averagingInt returns an optional average', r.out.includes('Optional[3.0]'), r.err || r.out);
  check('joining takes separator, prefix and suffix', r.out.includes('[ann, bob, amy, cat]'), r.err || r.out);
}
javaCheck('int arithmetic wraps at 32 bits', MAIN('        int big = Integer.MAX_VALUE;\n        System.out.println(big + 1);\n        System.out.println(2147483647 * 2);'), '-2147483648\n-2\n');
javaCheck(
  'string helpers: split, startsWith, replace, repeat, toCharArray',
  MAIN('        String s = "a,b,c";\n        System.out.println(s.split(",").length + " " + s.startsWith("a") + " " + s.replace(",", "-"));\n        System.out.println("ab".repeat(3) + " " + "hi".compareTo("ho"));\n        char[] cs = "xyz".toCharArray();\n        System.out.println(cs[1]);'),
  '3 true a-b-c\nababab -6\ny\n'
);
javaCheck(
  'Stack, Queue and PriorityQueue',
  'import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Stack<Integer> st = new Stack<>();\n        st.push(1); st.push(2); st.push(3);\n        System.out.println(st.pop() + " " + st.peek() + " " + st.size());\n        Queue<String> q = new LinkedList<>();\n        q.add("a"); q.add("b");\n        System.out.println(q.poll() + " " + q.peek());\n        PriorityQueue<Integer> pq = new PriorityQueue<>();\n        pq.add(5); pq.add(1); pq.add(3);\n        System.out.println(pq.poll() + " " + pq.poll());\n    }\n}',
  '3 2 2\na b\n1 3\n'
);
javaCheck(
  'TreeSet and TreeMap keep their order',
  'import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        Set<String> s = new TreeSet<>();\n        s.add("c"); s.add("a"); s.add("b"); s.add("a");\n        System.out.println(s);\n        Map<String, Integer> m = new TreeMap<>();\n        m.put("z", 1); m.put("a", 2);\n        System.out.println(m);\n    }\n}',
  '[a, b, c]\n{a=2, z=1}\n'
);
javaCheck(
  'varargs methods collect their arguments',
  'public class Main {\n    static int add(int... xs) {\n        int total = 0;\n        for (int x : xs) total += x;\n        return total;\n    }\n    public static void main(String[] args) {\n        System.out.println(add(1, 2, 3) + " " + add());\n    }\n}',
  '6 0\n'
);
javaCheck(
  'static initializer blocks run',
  'public class Main {\n    static int base;\n    static { base = 10; }\n    public static void main(String[] args) {\n        System.out.println(base + 1);\n    }\n}',
  '11\n'
);

javaCheck(
  'one declaration may name several variables',
  MAIN('        int a = 3, b = 4;\n        int[] xs = {1, 2}, ys = {5};\n        System.out.println(a + b + xs.length + ys[0]);'),
  '14\n'
);
javaCheck(
  'a for-init may declare several variables',
  'import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        int[] a = {1, 2, 3, 4, 6};\n        for (int i = 0, j = a.length - 1; i < j; i++, j--) {\n            int t = a[i]; a[i] = a[j]; a[j] = t;\n        }\n        System.out.println(Arrays.toString(a));\n    }\n}',
  '[6, 4, 3, 2, 1]\n'
);
javaCheck(
  'nested classes keep their own fields and qualified names',
  'public class Main {\n    static class Node {\n        int value;\n        Node next;\n        Node(int value) { this.value = value; }\n    }\n    public static void main(String[] args) {\n        Node head = new Node(1);\n        head.next = new Node(2);\n        System.out.println(head.value + "->" + head.next.value);\n        Outer.Node n = new Outer.Node(9);\n        System.out.println(n.tag);\n    }\n}\nclass Outer {\n    static class Node {\n        int tag;\n        Node(int t) { tag = t; }\n    }\n}',
  '1->2\n9\n'
);
javaCheck(
  'ArrayList copies the collection it is built from',
  'import java.util.*;\npublic class Main {\n    public static void main(String[] args) {\n        List<Integer> list = new ArrayList<>(Arrays.asList(3, 1, 2));\n        Collections.sort(list);\n        System.out.println(list + " max=" + Collections.max(list));\n    }\n}',
  '[1, 2, 3] max=3\n'
);
javaCheck(
  'a method reference can call an accessor',
  'import java.util.*;\nimport java.util.stream.*;\nrecord Person(String name, int age) {}\npublic class Main {\n    public static void main(String[] args) {\n        List<Person> people = List.of(new Person("ann", 30), new Person("bob", 17), new Person("cid", 42));\n        System.out.println(people.stream().filter(p -> p.age() >= 18).map(Person::name).collect(Collectors.toList()));\n        System.out.println(people.stream().mapToInt(p -> p.age()).sum());\n    }\n}',
  '[ann, cid]\n89\n'
);
javaCheck(
  'recursion with a memo map',
  'import java.util.*;\npublic class Main {\n    static Map<Integer, Integer> memo = new HashMap<>();\n    static int fib(int n) {\n        if (n < 2) return n;\n        if (memo.containsKey(n)) return memo.get(n);\n        int value = fib(n - 1) + fib(n - 2);\n        memo.put(n, value);\n        return value;\n    }\n    public static void main(String[] args) {\n        System.out.println(fib(10) + " memo=" + memo.size());\n    }\n}',
  '55 memo=9\n'
);
javaCheck(
  'interfaces in a list dispatch to the concrete class',
  'import java.util.*;\ninterface Op { int apply(int x); }\nclass Doubler implements Op { public int apply(int x) { return x * 2; } }\nclass Squarer implements Op { public int apply(int x) { return x * x; } }\npublic class Main {\n    public static void main(String[] args) {\n        List<Op> ops = new ArrayList<>();\n        ops.add(new Doubler());\n        ops.add(new Squarer());\n        for (Op op : ops) System.out.print(op.apply(4) + " ");\n        System.out.println();\n    }\n}',
  '8 16 \n'
);
javaCheck(
  'an exception thrown in recursion is caught by the caller',
  'public class Main {\n    static int depth = 0;\n    static void walk(int n) {\n        depth++;\n        if (n == 0) throw new IllegalStateException("bottom");\n        walk(n - 1);\n    }\n    public static void main(String[] args) {\n        try {\n            walk(3);\n        } catch (IllegalStateException e) {\n            System.out.println(e.getMessage() + " after " + depth);\n        }\n    }\n}',
  'bottom after 4\n'
);

/* ---------- comparators, literals, long and the library tail ---------- */

const JAVA = (body: string) => `import java.util.*;\nimport java.util.stream.*;\npublic class Main {\n    public static void main(String[] args) {\n${body}\n    }\n}`;

javaCheck(
  'Comparator.comparing sorts by a key',
  JAVA('        List<String> w = Arrays.asList("bb", "a", "ccc");\n        w.sort(Comparator.comparing(s -> s.length()));\n        System.out.println(w);'),
  '[a, bb, ccc]\n'
);
javaCheck(
  'comparingInt().reversed() and thenComparing',
  JAVA('        List<String> w = Arrays.asList("bb", "a", "cc", "b");\n        w.sort(Comparator.comparingInt(String::length).reversed().thenComparing(Comparator.naturalOrder()));\n        System.out.println(w);'),
  '[bb, cc, a, b]\n'
);
javaCheck(
  'Comparator.reverseOrder() builds a max-heap',
  JAVA('        PriorityQueue<Integer> pq = new PriorityQueue<>(Comparator.reverseOrder());\n        pq.add(1); pq.add(5); pq.add(3);\n        System.out.println(pq.poll() + " " + pq.poll());'),
  '5 3\n'
);
javaCheck(
  'a TreeMap honours a comparator',
  JAVA('        Map<String, Integer> m = new TreeMap<>(Comparator.reverseOrder());\n        m.put("a", 1); m.put("c", 3); m.put("b", 2);\n        System.out.println(m.keySet());'),
  '[c, b, a]\n'
);
javaCheck(
  'entries can be sorted by value',
  JAVA('        Map<String, Integer> m = new HashMap<>();\n        m.put("a", 3); m.put("b", 9); m.put("c", 1);\n        m.entrySet().stream().sorted(Map.Entry.<String,Integer>comparingByValue().reversed()).forEach(e -> System.out.print(e.getKey() + " "));\n        System.out.println();'),
  'b a c \n'
);
javaCheck(
  'hex, binary and underscore literals',
  JAVA('        int a = 0xFF;\n        int b = 0b1010;\n        int c = 1_000_000;\n        System.out.println(a + " " + b + " " + c);'),
  '255 10 1000000\n'
);
javaCheck(
  'long keeps 64-bit values',
  JAVA('        long big = 3000000000L;\n        long small = 2L;\n        System.out.println(big + 1 + " " + small * 3 + " " + Long.parseLong("5000000000"));'),
  '3000000001 6 5000000000\n'
);
javaCheck(
  'parseInt takes a radix and parseDouble exists',
  JAVA('        System.out.println(Integer.parseInt("ff", 16) + " " + Double.parseDouble("2.5") * 2);'),
  '255 5.0\n'
);
javaCheck(
  'binarySearch, copyOfRange and nCopies',
  JAVA('        int[] a = {1, 3, 5, 7};\n        System.out.println(Arrays.binarySearch(a, 5) + " " + Arrays.binarySearch(a, 4));\n        System.out.println(Arrays.toString(Arrays.copyOfRange(a, 1, 3)));\n        System.out.println(Collections.nCopies(2, "x"));'),
  '2 -3\n[3, 5]\n[x, x]\n'
);
javaCheck(
  'map compute / replace / putAll',
  JAVA('        Map<String, Integer> m = new HashMap<>();\n        m.put("a", 1);\n        m.compute("a", (k, v) -> v + 10);\n        m.replace("a", 99);\n        m.putAll(Collections.singletonMap("b", 2));\n        System.out.println(m);'),
  '{a=99, b=2}\n'
);
javaCheck(
  'an explicit Iterator walks a list',
  JAVA('        List<Integer> xs = Arrays.asList(1, 2, 3);\n        Iterator<Integer> it = xs.iterator();\n        while (it.hasNext()) System.out.print(it.next());\n        System.out.println();'),
  '123\n'
);
javaCheck(
  'String.matches, toBinaryString, bitCount and arraycopy',
  JAVA('        int[] a = {1, 2, 3};\n        int[] b = new int[3];\n        System.arraycopy(a, 0, b, 0, 3);\n        System.out.println("abc123".matches("[a-z]+[0-9]+") + " " + Integer.toBinaryString(10) + " " + Integer.bitCount(7) + " " + Arrays.toString(b));'),
  'true 1010 3 [1, 2, 3]\n'
);

/* ---------- JDK gaps closed after the capability probe ---------- */

javaCheck(
  'indexOf/lastIndexOf honour a from-index',
  JAVA('        String s = "banana";\n        System.out.println(s.indexOf("a", 2) + " " + s.lastIndexOf("an") + " " + s.indexOf(\'n\'));'),
  '3 3 2\n'
);
javaCheck(
  'replaceAll uses a regex, strip trims',
  JAVA('        System.out.println("a1b2".replaceAll("[0-9]", "#") + " " + "a1b2".replaceFirst("[0-9]", "#"));\n        System.out.println("[" + "  x  ".strip() + "]" + "[" + "  x  ".stripLeading() + "]");'),
  'a#b# a#b2\n[x][x  ]\n'
);
javaCheck(
  'split honours a limit by keeping the tail',
  JAVA('        String[] parts = "a,b,,c".split(",", 3);\n        System.out.println(parts.length + " " + parts[2]);'),
  '3 ,c\n'
);
javaCheck(
  'chars(), codePointAt and append(char[])',
  JAVA('        System.out.println("abc".chars().sum() + " " + "abc".codePointAt(0));\n        char[] cs = {\'!\', \'?\'};\n        System.out.println(new StringBuilder("hi").append(cs) + " " + String.valueOf(cs));'),
  '294 97\nhi!? !?\n'
);
javaCheck(
  'Arrays.sort/fill ranges and deepToString',
  JAVA('        int[] a = {5, 4, 3, 2, 1};\n        Arrays.sort(a, 1, 4);\n        int[][] g = {{1, 2}, {3}};\n        int[] b = new int[4];\n        Arrays.fill(b, 1, 3, 7);\n        System.out.println(Arrays.toString(a) + " " + Arrays.toString(b));\n        System.out.println(Arrays.deepToString(g));'),
  '[5, 2, 3, 4, 1] [0, 7, 7, 0]\n[[1, 2], [3]]\n'
);
javaCheck(
  'List.remove(int) vs remove(Object), subList, toArray',
  JAVA('        List<String> xs = new ArrayList<>(Arrays.asList("a", "b", "c"));\n        xs.remove("b");\n        List<Integer> ns = new ArrayList<>(Arrays.asList(7, 8, 9));\n        ns.remove(0);\n        System.out.println(xs + " " + ns + " " + xs.subList(0, 1) + " " + xs.toArray().length);'),
  '[a, c] [8, 9] [a] 2\n'
);
javaCheck(
  'TreeMap navigation and remove(key, value)',
  JAVA('        TreeMap<Integer, String> t = new TreeMap<>();\n        t.put(1, "a"); t.put(3, "c");\n        System.out.println(t.firstKey() + " " + t.lastKey() + " " + t.ceilingKey(2) + " " + t.floorKey(2));\n        System.out.println(t.remove(1, "z") + " " + t.size());'),
  '1 3 3 1\nfalse 2\n'
);
javaCheck(
  'TreeSet first/last/higher',
  JAVA('        TreeSet<Integer> s = new TreeSet<>(Arrays.asList(2, 1, 3));\n        System.out.println(s.first() + " " + s.last() + " " + s.higher(2) + " " + s.lower(2));'),
  '1 3 3 1\n'
);
javaCheck(
  'Optional.ofNullable, map, filter and or',
  JAVA('        Optional<String> empty = Optional.ofNullable(null);\n        Optional<Integer> some = Optional.of(3);\n        System.out.println(empty.orElse("none") + " " + some.map(x -> x * 2).get() + " " + some.filter(x -> x > 5).isPresent() + " " + empty.or(() -> Optional.of(9)).get());'),
  'none 6 false 9\n'
);
javaCheck(
  'naturalOrder sorts, signum/isWhitespace/isNull answer',
  JAVA('        List<Integer> xs = new ArrayList<>(Arrays.asList(3, 1, 2));\n        xs.sort(Comparator.naturalOrder());\n        System.out.println(xs + " " + Math.signum(-2.0) + " " + Character.isWhitespace(\' \') + " " + Objects.isNull(null));'),
  '[1, 2, 3] -1.0 true true\n'
);
javaCheck(
  'double methods print as doubles',
  'class Shape { double area() { int s = 3; return s * s; } }\nclass Main { public static void main(String[] args) { System.out.println(new Shape().area()); } }',
  '9.0\n'
);
javaCheck(
  'bitwise, shift and a labelled continue',
  JAVA('        int a = 5 & 3;\n        int b = 1 << 4;\n        int c = ~0;\n        int seen = 0;\n        outer: for (int r = 0; r < 3; r++) {\n            for (int col = 0; col < 3; col++) {\n                if (col == 1) continue outer;\n                seen++;\n            }\n        }\n        System.out.println(a + " " + b + " " + c + " " + seen);'),
  '1 16 -1 3\n'
);
javaCheck(
  'a class extending RuntimeException is caught by its parent type',
  'class Boom extends RuntimeException { Boom(String m) { super(m); } }\nclass Main {\n    static void boom() { throw new Boom("kaboom"); }\n    public static void main(String[] args) {\n        try { boom(); } catch (RuntimeException e) { System.out.println(e.getMessage()); }\n    }\n}',
  'kaboom\n'
);
javaCheck(
  'generic methods and String[]::new',
  'import java.util.*;\nimport java.util.stream.*;\nclass Main {\n    static <T> T first(List<T> xs) { return xs.get(0); }\n    public static void main(String[] args) {\n        System.out.println(first(Arrays.asList("z")) + " " + Stream.of("p", "q").toArray(String[]::new).length);\n    }\n}',
  'z 2\n'
);
javaCheck(
  'instanceof accepts an interface name',
  JAVA('        Object o = "hi";\n        System.out.println(o instanceof String);\n        System.out.println(o instanceof CharSequence);'),
  'true\ntrue\n'
);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
