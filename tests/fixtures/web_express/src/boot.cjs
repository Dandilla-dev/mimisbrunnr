const app = require('express')();

require('./mount.cjs')(app);

app.listen(4000);
