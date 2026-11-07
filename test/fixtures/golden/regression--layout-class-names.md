# Install the widget

This guide walks through installing the widget on a fresh machine, from removing old packages to checking that the service is running properly afterwards.

Run the following command to remove any packages that conflict with the widget before you go on to install it:

```console
sudo apt remove old-widget
```

Then add the package source, so that the system knows where to fetch the widget and its updates from when you next install or upgrade it:

```console
sudo add-source widget
```

Finally check that the service came up, which should print a short status message and return you to the prompt without any errors at all.
