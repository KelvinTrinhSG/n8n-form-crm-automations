// One item per rejected or failed row, for the "Import Rejects" tab.
return $input.first().json.rejects.map((r) => ({ json: r }));
