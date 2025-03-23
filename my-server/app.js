// Based on http://expressjs.com/en/starter/hello-world.html
const express = require('express')
const app = express()
const port = 4000

app.get('/', (req, res) => {
  res.send('Hello World!\n')
})

app.listen(port, () => {
  console.log(`OneCard app listening on port ${port}`)
})