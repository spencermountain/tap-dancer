//add commas to numbers
const niceNumber = x => {
  return x.toString().replace(/\B(?=(?:\d{3})+(?!\d))/g, ',')
}

const pad = function (str, width, char) {
  char = char || ' '
  str = str.toString()
  while (str.length < width) {
    str += char
  }
  return str
}

const duration = start => {
  return ((Date.now() - start) / 1000).toFixed(2)
}

export { niceNumber, pad, duration }
