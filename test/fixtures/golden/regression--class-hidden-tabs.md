# Installing the engine

The engine installs from the package repository, and you can either take whatever the newest release is or pin the exact release that the rest of your machines are already running.

Add the repository first, then choose one of the two ways below. Either way the service starts by itself once the packages are in place, and it needs nothing else to get going.

**Latest**

To install the latest version, run:

```
apt install engine
```

**Specific version**

To install a specific version, list what the repository has:

```
apt list --all-versions engine
```

Other sites give their panels proper roles, and hide the inactive one with a class name that only their stylesheet can explain, so nothing in the markup says it is hidden.

**Debian**

On Debian, the packages come from the same repository as everything else.

**Fedora**

On Fedora, the packages come from a separate repository that you add by hand.

That is all it takes to install the engine, and the next page goes on to show how to run your first container on the machine that you have just set up with it.
