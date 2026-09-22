//add commas to numbers
const niceNumber = x => {
  const str = x.toString()
  const result = []
  let digits = 0

  for (let i = str.length - 1; i >= 0; i--) {
    const char = str[i]
    digits = char >= '0' && char <= '9' ? digits + 1 : 0
    result.push(char)
    if (digits > 0 && digits % 3 === 0 && i > 0 && /\w/.test(str[i - 1])) {
      result.push(',')
    }
  }

  return result.reverse().join('')
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
