# ExampleSignal

Baseline: widely available since 2018.

**Note:** Also available in workers.

The **`ExampleSignal`** interface represents a signal object that lets you talk to an asynchronous operation and stop it when needed.

## Instance properties

The signal has properties that describe whether the operation stopped and why it stopped, read by any code that holds the signal. Each property is read only and reflects the current state of the signal at the time it is read.

Code that receives a signal can check these properties before doing more work, or listen for the stop event to clean up resources it holds while the operation runs in the background.

## Instance methods

The signal offers a method that throws the stop reason when the signal has stopped, so callers can bail out of long loops early without checking each property by hand on every iteration.

Static methods create signals that stop on their own after a timeout or when any one of several other signals stops, which makes it easy to combine cancellation sources in larger programs.
