export class Counter {
  constructor(start = 0) {
    this.value = start;
  }

  increment() {
    this.value += 1;
    return this.value;
  }

  reset() {
    this.value = 0;
  }
}

export class StepCounter extends Counter {
  incrementTwice() {
    this.increment();
    this.increment();
    super.reset();
  }
}
