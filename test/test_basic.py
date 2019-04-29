import logging
import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from element import Element, TIMEOUT, multipleElements

class GoogleHome(Element):
	def setup(self):
		self.search_field = Element(self, css='input.gsfi')
		self.search_button = Element(self, css='input[name="btnK"]')
		self.results = SearchResults(self, css='.g .r > a')

@multipleElements
class SearchResults(Element):
	def setup(self):
		self.title = Element(self, css='h3')

google = GoogleHome(None, url='https://www.google.com/')
google.search_field.send_keys('page objects')
google.search_button.click()

logging.info(len(google.results))
for result in google.results:
	logging.info(result.title.text())
google.results[0].has_text('Pattern')
google.results[0].click()

google.driver.close()
