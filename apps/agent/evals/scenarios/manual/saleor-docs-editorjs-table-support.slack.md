# Slack thread: EditorJS table support

## Message 1: start the thread

Post this in a channel where Paige is installed:

> @Paige, could you check a possible docs gap? Saleor 3.23.9 added support for
> `@editorjs/table`: https://github.com/saleor/saleor/releases/tag/3.23.9. The
> 3.23 backport is https://github.com/saleor/saleor/pull/19281, and its source
> adds `EditorJSTableBlockModel` to the accepted `EditorJSBlockModel` union in
> `saleor/core/editorjs/models.py`. I think the 3.22-to-3.23 upgrade guide may
> still list only the older supported EditorJS extensions. Please verify the
> current docs and report whether a change is needed. Don't publish anything
> yet.

Paige should capture the thread as a docs signal, treat the linked Saleor
release and backport as source evidence, inspect the working docs repository,
and report the gap. The evidence labels should link to the supplied source URLs
so Slack renders them as clickable links. Intake should not create the patch
yet.

## Message 2: request the patch

After Paige confirms the guide is stale, reply in the same thread:

> Please prepare the smallest accurate patch now. Keep it as a reversible
> draft, run the relevant checks, and show me the changed file and diff. Don't
> publish it yet.

Paige should keep the release, pull request, and package references linked in
the patch summary. Links written inside the diff remain code and are not
expected to be clickable.

## Optional message 3: test approved publication

Only after reviewing the diff, reply in the same thread:

> I've reviewed the diff. Please publish this as a draft PR to the configured
> working documentation repository.

This third message is the explicit approval boundary. Omit it when testing only
signal capture, verification, and sandbox authoring.
