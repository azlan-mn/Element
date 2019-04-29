import traceback
import re
import time
import logging
from selenium.webdriver.common.keys import Keys
from selenium import webdriver

TIMEOUT=15
logging.basicConfig(
	format='%(asctime)s %(message)s', datefmt='%y%m%d:%H%M:%S', level=logging.INFO
)

################################################################################
''' Conditions that can be applied and chained for an Element object.
Example:
	elem = Element(parent=self, id='test')
	assert elem.is_displayed().is_selected().has_text_regex(r'\d{4}.\d{2}')
'''
class ElementState(object):

	def exists(self, timeout=TIMEOUT):
		logging.info(u'[exists] ' + self.desc)
		return self if self._found(timeout) else None

	def not_exists(self, timeout=TIMEOUT):
		logging.info(u'[not_exists] ' + self.desc)
		return True if self._not_found(timeout) else None

	def is_displayed(self, timeout=TIMEOUT):
		logging.info(u'[is_displayed] ' + self.desc)
		return self if self._found(timeout) and self.element.is_displayed() else None

	def is_enabled(self, timeout=TIMEOUT):
		logging.info(u'[is_enabled] ' + self.desc)
		return self if self._found(timeout) and self.element.is_enabled() else None

	def is_selected(self, timeout=TIMEOUT):
		logging.info(u'[is_selected] ' + self.desc)
		return self if self._found(timeout) and self.element.is_selected() else None

	def text(self):
		return self.element.text

	def has_text(self, search_text, timeout=TIMEOUT):
		log = u'[has_text] {}: {}'.format(self.desc, search_text)
		return self.waitfor(
			lambda st=search_text: st in self.text(),
			timeout, log, True
		)

	def has_text_regex(self, search_regex, timeout=TIMEOUT):
		log = u'[has_text_regex] {}: {}'.format(self.desc, search_regex)
		return self.waitfor(
			lambda sr=search_regex: re.compile(sr).search(self.text()) != None,
			timeout, log, True
		)

################################################################################
''' Additional helper methods
'''
class ElementUtils(object):

	def saferun(self, command, *args, **kwargs):
		try:
			return command(*args, **kwargs)
		except Exception as e:
			return False

	def wait(self, duration=1):
		time.sleep(duration)

	def waitfor(self, command, timeout=TIMEOUT, desc='', raises_exception=False):
		timeout = timeout if timeout else 1 # prevent 0 timeout
		for countdown in range(timeout, 0, -1):
			try:
				if command(): 
					logging.info(desc)
					return self
			except:
				time.sleep(1)
		if raises_exception: raise Exception('Timeout for ' + desc)
		return None

################################################################################
''' Additional actions and properties supported by Element.
TODO: Add logging info for each attribute.
'''
class ElementActions(object):

	def click(self, timeout=TIMEOUT):
		return self.waitfor(lambda: (self.element.click(), True)[-1],
			timeout, u'[click] {}'.format(self.desc), True)

	def clear(self, timeout=TIMEOUT):
		return self.waitfor(lambda: (self.element.clear(), True)[-1],
			timeout, u'[clear] {}'.format(self.desc), True)

	def send_keys(self, string, timeout=TIMEOUT):
		return self.waitfor(lambda st=string: (self.element.send_keys(st), True)[-1],
			timeout, u'[send_keys] {}: "{}"'.format(self.desc, string), True)

################################################################################
''' ELement class that represents all page objects.
**kwargs: First locator method found will be used. Supported methods:
id_, name, xpath, css, class_name, link_text, partial_link_text, tag_name
'''
class Element(ElementActions, ElementState, ElementUtils):
	def __init__(self, parent, url=None, iframe=None, webelement=None, desc=None, **kwargs):
		self.webelement = webelement if webelement else None
		self.webelements = [self.webelement]
		self.iframe = iframe
		self.parent = parent
		self.driver = parent.driver if parent else webdriver.Chrome()
		self.kwargs = kwargs
		self.lookup_method = self.query = ''

		if desc:
			self._desc = desc
		else:
			text = traceback.extract_stack()[-2][-1]
			self._desc = text[:text.find('=')].strip().split('.')[-1]

		lookup_methods = {
			'css': 'css_selector', 'id_': 'id', 'name': 'name', 'xpath': 'xpath', 'class_name': 'class_name',
			'link_text': 'link_text', 'partial_link_text': 'partial_link_text', 'tag_name': 'tag_name'
		}
		for self.lookup_method, self.query in kwargs.items():
			if self.lookup_method in lookup_methods:
				self.lookup_method = lookup_methods[self.lookup_method]
				break

		if hasattr(self, 'setup'):
			self.setup()

		if url:
			self.driver.implicitly_wait(0)
			self.driver.get(url)

	@property
	def element(self):
		try:
			# trigger element staleness
			self.webelement.size
			self.webelement.location
		except:
			self._find()
		return self.webelement

	@property
	def elements(self):
		self.element
		return self.webelements

	@property
	def desc(self):
		parent = '{}.'.format(self.parent.desc) if self.parent else ''
		return '{}{}'.format(parent, self._desc)

	def _found(self, timeout=TIMEOUT):
		return self.waitfor(self._find, timeout, u'_found: {}'.format(self), True)

	def _not_found(self, timeout=TIMEOUT):
		return self.waitfor(lambda: not self._find(), timeout, u'_not_found: {}'.format(self), True)

	def _find(self):
		find_context = self.driver
		if self.parent and self.parent.parent:
			# Sets search context to parent. Also refreshs the parent
			find_context = self.parent.element
		else:
			# Root, no iframes possible
			self.driver.switch_to.default_content()
		if self.iframe:
			# Parent doesn't exist in iframe
			find_context = self.driver 
			self.driver.switch_to.frame(self.iframe.element)
		lookup_method = getattr(find_context, u'find_elements_by_{}'.format(self.lookup_method))
		try:
			results = lookup_method(self.query)
			self.webelement, self.webelements = results[0], results
			return True
		except Exception as e:
			self.webelement, self.webelements = None, []
			return False

	def __repr__(self):
		return self.desc

	def __str__(self):
		return '{} [{}={}].'.format(self.desc, self.lookup_method, self.query)

################################################################################
''' Decorator that returns Element(s) as a list
'''
def multipleElements(cls):
	class multipleElementsWrapper(Element):
		@property
		def multiple(self):
			if not hasattr(self, '_multiple'):
				self._multiple = []
				for idx, webelement in enumerate(self.elements):
					self._multiple.append(cls(self.parent, None, self.iframe, webelement, u'{}[{}]'.format(self._desc, str(idx)), **self.kwargs))
			return self._multiple		
		def __len__(self):
			return len(self.elements)
		def __iter__(self):
			return iter(self.multiple)
		def __getitem__(self, index):
			return self.multiple[index]
	return multipleElementsWrapper
