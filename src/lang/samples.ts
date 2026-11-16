import type { LangSample } from './types';

export const PY_SAMPLES: LangSample[] = [
  {
    id: 'py-bubble',
    label: 'Bubble sort',
    code: `def bubble_sort(a):
    n = len(a)
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]


values = [5, 2, 9, 1, 7, 3]
bubble_sort(values)
print("sorted:", values)`,
  },
  {
    id: 'py-fib',
    label: 'Recursion · fib',
    code: `def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)


n = 6
answer = fib(n)
print("fib(" + str(n) + ") =", answer)`,
  },
  {
    id: 'py-binary',
    label: 'Binary search',
    code: `def binary_search(a, target):
    lo = 0
    hi = len(a) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if a[mid] == target:
            return mid
        if a[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1


data = [1, 3, 5, 8, 12, 17, 21]
index = binary_search(data, 12)
print("found at", index)`,
  },
  {
    id: 'py-stack',
    label: 'Stack · list',
    code: `stack = []
stack.append(3)
stack.append(8)
stack.append(5)
popped = stack.pop()
print("popped", popped, "left", len(stack))`,
  },
];

export const JS_SAMPLES: LangSample[] = [
  {
    id: 'js-bubble',
    label: 'Bubble sort',
    code: `function bubbleSort(a) {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < a.length - 1 - i; j++) {
      if (a[j] > a[j + 1]) {
        const temp = a[j];
        a[j] = a[j + 1];
        a[j + 1] = temp;
      }
    }
  }
}

const values = [5, 2, 9, 1, 7, 3];
bubbleSort(values);
console.log("sorted:", values);`,
  },
  {
    id: 'js-fib',
    label: 'Recursion · fib',
    code: `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

const n = 6;
const answer = fib(n);
console.log("fib(" + n + ") = " + answer);`,
  },
  {
    id: 'js-pair',
    label: 'Two pointers',
    code: `function twoSum(a, target) {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const sum = a[lo] + a[hi];
    if (sum === target) return [lo, hi];
    if (sum < target) lo++;
    else hi--;
  }
  return [];
}

const data = [2, 7, 11, 15];
const pair = twoSum(data, 9);
console.log("pair:", pair);`,
  },
  {
    id: 'js-stack',
    label: 'Stack · push/pop',
    code: `const stack = [];
stack.push(3);
stack.push(8);
stack.push(5);
const popped = stack.pop();
console.log("popped", popped, "left", stack.length);`,
  },
];

export const CPP_SAMPLES: LangSample[] = [
  {
    id: 'cpp-bubble',
    label: 'Bubble sort',
    code: `#include <iostream>
#include <vector>
using namespace std;

void bubbleSort(vector<int>& a) {
    int n = a.size();
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (a[j] > a[j + 1]) {
                int temp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = temp;
            }
        }
    }
}

int main() {
    vector<int> values = {5, 2, 9, 1, 7, 3};
    bubbleSort(values);
    cout << "sorted:" << endl;
    for (int i = 0; i < values.size(); i++) {
        cout << values[i] << " ";
    }
    cout << endl;
    return 0;
}`,
  },
  {
    id: 'cpp-fib',
    label: 'Recursion · fib',
    code: `#include <iostream>
using namespace std;

int fib(int n) {
    if (n <= 1) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

int main() {
    int n = 6;
    int answer = fib(n);
    cout << "fib(" << n << ") = " << answer << endl;
    return 0;
}`,
  },
  {
    id: 'cpp-list',
    label: 'Linked list',
    code: `#include <iostream>
using namespace std;

struct Node {
    int value;
    Node* next;

    Node(int value) {
        this->value = value;
        this->next = nullptr;
    }
};

Node* push(Node* head, int value) {
    Node* node = new Node(value);
    node->next = head;
    return node;
}

int main() {
    Node* head = nullptr;
    for (int i = 1; i <= 4; i++) {
        head = push(head, i * 10);
    }

    Node* cur = head;
    while (cur != nullptr) {
        cout << cur->value << " ";
        cur = cur->next;
    }
    cout << endl;
    return 0;
}`,
  },
];
