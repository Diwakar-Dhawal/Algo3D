export type Sample = {
  id: string;
  label: string;
  blurb: string;
  code: string;
  /** preloaded standard input, for samples that read through Scanner */
  stdin?: string;
};

export const SAMPLES: Sample[] = [
  {
    id: 'bubble',
    label: 'Bubble sort',
    blurb: 'Arrays, swaps, heap writes',
    code: `class Main {
    public static void main(String[] args) {
        int[] a = {5, 2, 9, 1, 7, 3};
        bubbleSort(a);
        System.out.println("sorted:");
        printArray(a);
    }

    static void bubbleSort(int[] a) {
        int n = a.length;
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

    static void printArray(int[] a) {
        for (int i = 0; i < a.length; i++) {
            System.out.print(a[i]);
            System.out.print(" ");
        }
        System.out.println();
    }
}`,
  },
  {
    id: 'fib',
    label: 'Recursion · fib',
    blurb: 'Call stack growth',
    code: `class Main {
    public static void main(String[] args) {
        int n = 6;
        int answer = fib(n);
        System.out.println("fib(" + n + ") = " + answer);
    }

    static int fib(int n) {
        if (n <= 1) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }
}`,
  },
  {
    id: 'list',
    label: 'Linked list',
    blurb: 'Objects, fields, references',
    code: `class Node {
    int value;
    Node next;

    Node(int value) {
        this.value = value;
        this.next = null;
    }
}

class Main {
    public static void main(String[] args) {
        Node head = null;
        for (int i = 1; i <= 4; i++) {
            head = push(head, i * 10);
        }

        Node cur = head;
        while (cur != null) {
            System.out.println(cur.value);
            cur = cur.next;
        }
    }

    static Node push(Node head, int value) {
        Node node = new Node(value);
        node.next = head;
        return node;
    }
}`,
  },
  {
    id: 'tree',
    label: 'Binary tree',
    blurb: 'left / right child references',
    code: `class TreeNode {
    int value;
    TreeNode left;
    TreeNode right;

    TreeNode(int value) {
        this.value = value;
    }
}

class Main {
    public static void main(String[] args) {
        TreeNode root = null;
        root = insert(root, 50);
        root = insert(root, 30);
        root = insert(root, 70);
        root = insert(root, 20);
        root = insert(root, 40);
        inorder(root);
        System.out.println();
    }

    static TreeNode insert(TreeNode node, int value) {
        if (node == null) {
            return new TreeNode(value);
        }
        if (value < node.value) {
            node.left = insert(node.left, value);
        } else if (value > node.value) {
            node.right = insert(node.right, value);
        }
        return node;
    }

    static void inorder(TreeNode node) {
        if (node == null) return;
        inorder(node.left);
        System.out.print(node.value + " ");
        inorder(node.right);
    }
}`,
  },
  {
    id: 'matrix',
    label: '2D array',
    blurb: 'Nested arrays on the heap',
    code: `class Main {
    public static void main(String[] args) {
        int[][] grid = new int[3][4];

        for (int r = 0; r < grid.length; r++) {
            for (int c = 0; c < grid[r].length; c++) {
                grid[r][c] = (r + 1) * (c + 1);
            }
        }

        int sum = 0;
        for (int r = 0; r < 3; r++) {
            for (int c = 0; c < 4; c++) {
                sum += grid[r][c];
            }
        }
        System.out.println("sum = " + sum);
    }
}`,
  },
  {
    id: 'stack',
    label: 'Stack class',
    blurb: 'Instance fields, this',
    code: `class Stack {
    int[] data = new int[5];
    int top = 0;

    void push(int value) {
        data[top] = value;
        top++;
    }

    int pop() {
        top--;
        return data[top];
    }
}

class Main {
    public static void main(String[] args) {
        Stack s = new Stack();
        s.push(3);
        s.push(8);
        s.push(5);
        int popped = s.pop();
        System.out.println("popped " + popped);
    }
}`,
  },
  {
    id: 'arraylist',
    label: 'ArrayList',
    blurb: 'Growable list',
    code: `import java.util.ArrayList;

class Main {
    public static void main(String[] args) {
        ArrayList<Integer> nums = new ArrayList<>();
        nums.add(4);
        nums.add(9);
        nums.add(2);

        int total = 0;
        for (int i = 0; i < nums.size(); i++) {
            total += nums.get(i);
        }
        System.out.println("total = " + total);
    }
}`,
  },
  {
    id: 'streams',
    label: 'Streams & maps',
    blurb: 'Lambdas, filters, maps',
    code: `import java.util.*;
import java.util.stream.*;

public class Main {
    public static void main(String[] args) {
        int[] scores = {72, 48, 90, 65, 55};

        // filter + map + collect
        List<Integer> passing = Arrays.stream(scores)
            .filter(s -> s >= 60)
            .boxed()
            .collect(Collectors.toList());
        System.out.println("passing: " + passing);

        // keySet streamed back into a map lookup
        Map<String, Integer> age = new HashMap<>();
        age.put("ann", 30);
        age.put("bob", 25);
        age.put("cid", 41);

        int total = age.keySet().stream().mapToInt(k -> age.get(k)).sum();
        System.out.println("total age: " + total);

        // method reference
        passing.forEach(System.out::println);
    }
}`,
  },
  {
    id: 'scanner',
    label: 'Console input · Scanner',
    blurb: 'Reads values from standard input',
    stdin: '5\n4 8 1 9 3',
    code: `import java.util.Scanner;

class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();                    // how many values follow
        int[] values = new int[n];
        for (int i = 0; i < n; i++) {
            values[i] = in.nextInt();
        }

        int total = 0;
        for (int i = 0; i < n; i++) {
            total += values[i];
        }
        System.out.println("sum = " + total);
        System.out.println("average = " + (total / n));
    }
}`,
  },
];

export const DEFAULT_CODE = SAMPLES[0].code;
