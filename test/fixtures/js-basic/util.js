// Adds two numbers.
function add(a, b) {
  return a + b;
}

const double = function (n) {
  return add(n, n);
};

export class Counter {
  count = 0;
  increment() {
    this.count++;
  }
}
