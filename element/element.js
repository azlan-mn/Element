const assert = require('assert')
const fs = require('fs')
const path = require('path')
const RETRY_COUNT = 20
const RETRY_WAIT = 0.5

/**
 * Wrapper around ElementHandle to allow early page object definition with deferred element detection.
 * @constructor
 * @param {Element} parent - Instance of Element in page hierarchy nesting this Element.
 * @param {string} name - String identifier and also property name attached to parent.
 * @param {string} options.dti - Unique data-testid. Overrides css selector and xpath.
 * @param {string} options.css - CSS Selector used to identify this element
 * @param {string} options.xpath - XPath Selector used to identify this element. Overrides css.
 * @param {boolean} options.iframe - Search context of nested child will be from frame content.
 * @param {boolean} options.detach - Search context will be from _page instead of parent.
 */
class Element {
  constructor(parent, name = 'root', options = {}) {
    this._parent = parent
    this._elementName = name
    if (options.dti) {
      this._css = `[data-testid="${options.dti}"]`
    } else if (options.css) {
      this._css = options.css
    } else {
      this._xpath = options.xpath || '.'
    }
    this._iframe = options.iframe || false
    this._detach = options.detach || false
    this._page = this.isRoot() ? this._parent : this._parent._page
    this._index = 0
    this.setup()
  }

  /**
   * Automatically called by constructor. Add nested elements here. To be overidden in subclass.
   */
  setup() {}

  /**
   * Navigate to specified url
   * @param {string} url - Address to navigate to.
   */
  async goto(url) {
    this.log('[GOTO] ' + url)
    return this._page.goto(url, { timeout: 120000, waitUntil: 'domcontentloaded' })
  }

  /**
   * Click the element using puppeteer.
   */
  async click(retry = RETRY_COUNT, suppressLog = false) {
    if (!suppressLog) this.log('[CLCK] ' + this.elementName)
    return (await this.element(retry)).click()
  }

  /**
   * Clicks the element using client-side js. Works for elements hidden under other elements.
   */
  async clickHidden(retry = RETRY_COUNT, suppressLog = false) {
    if (!suppressLog) this.log('[CLCK] ' + this.elementName)
    await this._page.evaluate(
      (elm) => { elm.click() }, await this.element(retry)
    )
  }

  /**
   * Triggers reload of page the element is shown in.
   */
  async reload(waitUntilFullyLoaded = false) {
    this.log('[RLOD] ' + this.elementName)
    if (waitUntilFullyLoaded) {
      waitUntilFullyLoaded = 'load'
    } else {
      waitUntilFullyLoaded = 'domcontentloaded'
    }
    return this._page.reload({ waitUntil: waitUntilFullyLoaded })
  }

  /**
   * Mouseover the element to trigger client-side onhover event.
   */
  async hover(retry = RETRY_COUNT) {
    this.log('[HOVR] ' + this.elementName)
    return (await this.element(retry)).hover()
  }

  /**
   * Enter specified text into the element.
   * @param {boolean} options.pressEnter - Presses enter after text input is complete.
   * @param {boolean} options.preClear - Sets element value to '' before text input.
   * @param {boolean} options.maskLog - Masks typed text in debug log.
   * @param {integer} options.delay - Wait duration between key presses (ms).
   */
  async type(text, options = {}) {
    const logText = options.maskLog ? '*'.repeat(text.length) : text
    const delay = options.delay ? options.delay : 5
    await this.isVisible(RETRY_COUNT, true)
    await this.click(RETRY_COUNT, true)
    await this.wait(0.5)
    this.log('[TYPE] ' + this.elementName + ' [TEXT] ' + logText)
    if (options.pressEnter) {
      text += String.fromCharCode(13)
    }
    if (options.preClear) {
      await this.setAttribute('value', '')
      while (this.text().length > 0) {
        await this.press('Backspace')
      }
    }
    await (await this.element()).type(text, { delay: delay })
    await this.wait(0.5)
  }

  /**
   * Used to send special keys: Up, Enter, Escape, etc.
   * @param {string} text - Special key to press.
   */
  async press(text) {
    this.log('[PRSS] ' + this.elementName + ' [TEXT] ' + text)
    return (await this.element()).press(text)
  }

  /**
   * Sets the checkbox value by clicking it.
   * @param {boolean} checked - Desired checkbox value.
   */
  async check(checked = true) {
    this.log('[CHCK] ' + this.elementName + ' [VAL] ' + checked)
    if (await this.getAttribute('checked') !== checked) {
      await this.clickHidden()
    }
  }

  /**
   * Waits the specified duration (seconds).
   * @param {integer} duration - Wait duration (s).
   */
  async wait(duration = 5) {
    return this._page.waitFor(duration * 1000)
  }

  /**
   * Asserts the element is visible. Multiple attempts / retries possible.
   * @param {integer} retry - Number of times to retry.
   */
  async isVisible(retry = RETRY_COUNT, suppressLog = false) {
    if (!suppressLog) this.log('[VSBL] ' + this.elementName)
    while (retry-- && !(await this.visible(0))) {
      await this.wait(RETRY_WAIT)
    }
    await this.assert(retry > 0, this.elementName + ': isVisible failed.')
  }

  /**
   * Asserts the element is not visible. Multiple attempts / retries possible.
   * @param {integer} retry - Number of times to retry.
   */
  async isHidden(retry = RETRY_COUNT) {
    this.log('[HIDN] ' + this.elementName)
    while (retry-- && (await this.visible(0))) {
      await this.wait(RETRY_WAIT)
    }
    await this.assert(retry > 0, this.elementName + ': isHidden failed.')
  }

  /**
   * Returns if the element has a bounding box / visible.
   * @param {integer} retry - Number of times to retry.
   */
  async visible(retry = RETRY_COUNT) {
    try {
      return (await (await this.element(retry)).boundingBox()) != null
    } catch (error) {
      return false
    }
  }

  /**
   * String identifier of this element to aid debugging.
   */
  get elementName() {
    if (this.isRoot()) {
      return this._elementName
    }
    return this._parent.elementName + '.' + this._elementName
  }

  /**
   * Sets element dom attribute to a value.
   * @param {string} attr - Attribute to change.
   * @param {string} value - Value to change to.
   */
  async setAttribute(attr, value) {
    return this._page.evaluate(
      (elm, attr, value) => { elm[attr] = value }, await this.element(), attr, value
    )
  }

  /**
   * Returns element dom attribute.
   * @param {string} attr - Attribute value to get.
   */
  async getAttribute(attr) {
    return this._page.evaluate(
      (elm, attr) => elm[attr], await this.element(), attr
    )
  }

  /**
   * Returns element dom attribute.
   * @param {string} attr - Attribute value to get.
   */
  async getProperty(attr) {
    return (await this.element()).getProperty(attr)
  }

  /**
   * Returns element dom attribute text.
   */
  async text() {
    const texts = ['innerText', 'value', 'textContent']
    for (let i = 0; i < texts.length; i++) {
      let text = await this.getAttribute(texts[i])
      if (text && text.length > 0) {
        return text
      }
    }
    return ''
  }

  /**
   * Asserts element.text does not contain text. Uses partial match.
   * If the selector matches multiple items, all items will be searched.
   * @param {string} text - Searched string.
   * @param {integer} retry - Number of times to retry.
   */
  async textNotContains(text, retry = RETRY_COUNT) {
    this.log('[TXNC] ' + this.elementName + ' [TEXT] ' + text)
    while (retry-- && (await this.textContainsMultiHelper(text))) {
      await this.wait(RETRY_WAIT)
    }
    await this.assert(retry > 0, this.elementName + ': textNotContains found [' + text + ']')
  }

  /**
   * Asserts element.text contains text. Uses partial match.
   * If the selector matches multiple items, all items will be searched.
   * @param {string} text - Expected string.
   * @param {integer} retry - Number of times to retry.
   */
  async textContains(text, retry = RETRY_COUNT) {
    this.log('[TXTC] ' + this.elementName + ' [TEXT] ' + text)
    while (retry-- && !(await this.textContainsMultiHelper(text))) {
      await this.wait(RETRY_WAIT)
    }
    await this.assert(retry > 0, this.elementName + ': textContains failed to find [' + text + ']')
  }
  async textContainsMultiHelper(text) {
    for (let i = 0; i < (await this.elements()).length; i++) {
      await this.elements(i) // switch to the next element
      if ((await this.text()).indexOf(text) > -1) {
        return true
      }
    }
    return false
  }

  /**
   * Returns amn array of _element that contain text
   * @param {string} text - Expected string.
   */
  async elementsWithText(text, retry = RETRY_COUNT) {
    let ret = []
    for (let i = 0; i < (await this.elements()).length; i++) {
      await this.elements(i) // switch to the next element
      if ((await this.text()).indexOf(text) > -1) {
        ret.push(this._element)
      }
    }
    return ret
  }

  /**
   * Asserts page.url contains the given string.
   * @param {string} text - Expected string.
   */
  urlContains(text) {
    this.log('[URLC] ' + text)
    this.assert(this.getUrl().indexOf(text) !== -1,
      'urlContains failed to find [' + text + ']')
  }
  getUrl() {
    const url = this._page.url()
    this.log('[URL] ' + url)
    return url
  }

  /**
   * Returns true if this element is topmost in page hierarchy.
   */
  isRoot() {
    return this._parent.constructor.name === 'Page'
  }

  /**
   * Returns the found element.
   * @param {integer} retry - Number of times to retry.
   */
  async element(retry = RETRY_COUNT) {
    [this._element, this._elements] = await this.find(retry)
    return this._element
  }

  /**
   * Access specific element if selector returns multiple results.
   * @param {integer} idx - Index of the element from list of elements found. Returns all elements if omitted.
   */
  async elements(idx = -1) {
    if (idx > -1) {
      this._index = idx
    }
    await this.element(1)
    if (idx === -1) {
      return this._elements
    }
    return this._element
  }

  /**
   * finds the element using css or xpath selector.
   * find chains up to the root element.
   * Returns the found element or throws exception.
   * @param {integer} retry - Number of times to retry.
  */
  async find(retry = RETRY_COUNT) {
    let elements
    // Initially search from root (page)
    let context = this._page

    // Change search context if element isn't detached from parent
    if (!this._detach) {
      // Search from parent if it's an element
      if (!this.isRoot()) {
        context = await this._parent.element(retry)
      }
      // Search from parent contentFrame if direct child of iframe
      if (this._parent._iframe) {
        context = await context.contentFrame()
      }
    }

    try {
      if (this._xpath) {
        elements = await context.$x(this._xpath)
      } else {
        elements = await context.$$(this._css)
      }
      // Remove any hidden elements
      elements.forEach(function(element) {
        if (element.boundingBox === null) {
          elements = elements.filter(item => item !== element)
        }
      })
      assert(elements.length > 0, 'Element not found: ' + this.elementName)
    } catch (error) {
      if (retry--) {
        await this.wait(RETRY_WAIT)
        elements = await this.find(retry)
      } else {
        await this.screenshot()
        throw error
      }
    }
    this._index = this._index < elements.length ? this._index : 0
    return [elements[this._index], elements]
  }

  /**
   * Accept all delete confirmation dialogs
   */
  async acceptAllDialogs() {
    this._page.on('dialog', async dialog => {
      await dialog.accept()
    })
  }

  /**
   * Scrolls to the bottom of page
   */
  async scrollToBottom() {
    await this._page.evaluate(() => {
      window.scrollBy(0, document.body.scrollHeight)
    })
  }

  /**
   * Captures screenshot of the visible page
   */
  async screenshot() {
    try {
      await this._page.screenshot({ 'path': path.join('.', 'logs', this.elementName + '_' + Date.now() + '.png') })
    } catch (error) {
    }
  }

  /**
   * Wraps assert to capture screenshot on failure
   * @param {boolean} pass - Assert pass or fail.
   * @param {string} message - Assert message.
   */
  async assert(pass, message) {
    try {
      assert(pass, message)
    } catch (error) {
      await this.screenshot()
      throw error
    }
  }

  /**
   * Prints message str to logs/combined.log
   * @param {string} message - Message to append to log.
   */
  log(message) {
    fs.appendFileSync(path.join('.', 'logs', 'combined.log'), message + '\n')
  }
}

module.exports = Element
